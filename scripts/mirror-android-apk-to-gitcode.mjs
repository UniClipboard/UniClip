#!/usr/bin/env node

// Copies the already built and signed Android APK to a GitCode Release and
// registers the verified copy with FlareRelease. It never rebuilds or re-signs:
// the bytes uploaded are the bytes of --apk, and they are downloaded back
// anonymously and compared by size and SHA-256 before FlareRelease is told
// the mirror is ready. GitHub/R2 remain the authoritative sources; this step
// only ever adds an optional copy.

import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';

const DEFAULT_API_BASE = 'https://api.gitcode.com/api/v5';
const DEFAULT_ADMIN_URL = 'https://release-admin.uniclipboard.app';
// Keep in sync with FlareRelease src/domain/mirror.ts (the server enforces it too).
const ALLOWED_HOSTS = ['gitcode.com', 'atomgit.com'];
const MAX_REDIRECTS = 5;

class MirrorError extends Error {}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new MirrorError(`${name} requires a value`);
  return value;
}

const hasFlag = (name) => process.argv.includes(name);

function numberArg(name, fallback) {
  const raw = argValue(name, undefined);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new MirrorError(`${name} must be a non-negative number`);
  return value;
}

export function isRegistrableUrl(value, { allowLocal = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (allowLocal && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)) {
    return true;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  if (url.search || url.hash) return false;
  return ALLOWED_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

function redact(text, secrets) {
  let output = String(text).replace(/access_token=[^&\s"']+/g, 'access_token=***');
  for (const secret of secrets) {
    if (secret) output = output.split(secret).join('***');
  }
  return output;
}

async function sha256File(path) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { sha256: hash.digest('hex'), size };
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

// One deadline for the whole run. A workflow job timeout would fail the job even
// for a non-blocking step, so the script has to stop on its own, earlier.
let deadlineAt = Number.POSITIVE_INFINITY;
let deadlineMs = 0;
const remaining = () => Math.max(1, deadlineAt - Date.now());
const pastDeadline = () => Date.now() >= deadlineAt;
const deadlineError = (detail) => new MirrorError(`deadline of ${deadlineMs} ms exceeded (${detail})`);

async function withRetries(label, attempts, delayMs, task) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (pastDeadline()) throw deadlineError(label);
    try {
      return await task(attempt);
    } catch (error) {
      last = error;
      if (error?.permanent) break;
      if (pastDeadline()) throw deadlineError(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      if (attempt < attempts) await sleep(Math.min(delayMs * attempt, remaining()));
    }
  }
  const message = last instanceof Error ? last.message : String(last);
  throw new MirrorError(`${label} failed after ${attempts} attempt(s): ${message}`);
}

function timeoutSignal(ms) {
  return AbortSignal.any([AbortSignal.timeout(ms), AbortSignal.timeout(remaining())]);
}

function assertSuccess(response, label, body) {
  if (response.ok) return;
  const error = new Error(`${label} returned HTTP ${response.status}${body ? `: ${String(body).slice(0, 300)}` : ''}`);
  // Client errors other than throttling will not change on retry.
  if (response.status >= 400 && response.status < 500 && response.status !== 429 && response.status !== 408) {
    error.permanent = true;
  }
  throw error;
}

export async function mirrorApk(config) {
  const {
    apkPath,
    tag,
    version,
    prerelease,
    source,
    token,
    owner,
    repo,
    apiBase,
    adminUrl,
    accessId,
    accessSecret,
    targetCommitish,
    allowLocal,
    attempts,
    delayMs,
    pollIntervalMs,
    pollAttempts,
    apiTimeoutMs,
    transferTimeoutMs,
    deadlineMs: totalDeadlineMs,
    log,
  } = config;
  deadlineMs = totalDeadlineMs;
  deadlineAt = Date.now() + totalDeadlineMs;
  const secrets = [token, accessSecret, accessId];
  const filename = basename(apkPath);
  const { sha256, size } = await sha256File(apkPath);
  const record = { tag, version, filename, size, sha256, provider: 'gitcode', owner, repo, source };
  log(`APK ${filename}: ${size} bytes, sha256 ${sha256}`);

  const api = async (method, path, { query = {}, body } = {}) => {
    const url = new URL(`${apiBase}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    url.searchParams.set('access_token', token);
    const response = await fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: timeoutSignal(apiTimeoutMs),
    });
    const text = await response.text();
    return { response, text, json: () => (text ? JSON.parse(text) : null) };
  };

  const releasePath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`;
  const tagPath = `${releasePath}/${encodeURIComponent(tag)}`;

  // 1. Make sure the GitCode release for this tag exists.
  const fetchRelease = () =>
    withRetries('Reading the GitCode release', attempts, delayMs, async () => {
      const { response, text, json } = await api('GET', `${releasePath}/tags/${encodeURIComponent(tag)}`);
      if (response.status === 404) return null;
      assertSuccess(response, 'Reading the GitCode release', redact(text, secrets));
      return json();
    });
  let release = await fetchRelease();
  if (!release) {
    log(`Creating GitCode release ${tag}`);
    await withRetries('Creating the GitCode release', attempts, delayMs, async () => {
      const { response, text } = await api('POST', releasePath, {
        body: {
          tag_name: tag,
          name: tag,
          body: `Mirror of the GitHub release ${tag}.`,
          target_commitish: targetCommitish,
          release_status: prerelease ? 'pre' : 'latest',
        },
      });
      assertSuccess(response, 'Creating the GitCode release', redact(text, secrets));
    });
    release = await fetchRelease();
    if (!release) throw new MirrorError('The GitCode release is not readable after it was created');
  }

  const findAsset = (value) => (value?.assets ?? []).find((asset) => asset.name === filename);
  const apiDownloadUrl = `${apiBase}${tagPath}/attach_files/${encodeURIComponent(filename)}/download`;

  // 2. Download anonymously: no token, no cookies, redirects followed by hand
  //    so every hop can be checked and recorded.
  const download = async (startUrl) => {
    const chain = [];
    let url = startUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const target = new URL(url);
      if (!(target.protocol === 'https:' || (allowLocal && target.protocol === 'http:'))) {
        throw new MirrorError(`Download redirected to a non-https address: ${target.protocol}//${target.host}`);
      }
      chain.push(`${target.origin}${target.pathname}`);
      const response = await fetch(url, { redirect: 'manual', signal: timeoutSignal(transferTimeoutMs) });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new MirrorError(`HTTP ${response.status} without a Location header`);
        url = new URL(location, url).href;
        await response.body?.cancel();
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new MirrorError(`Anonymous download returned HTTP ${response.status}`);
      }
      const hash = createHash('sha256');
      let received = 0;
      for await (const chunk of Readable.fromWeb(response.body)) {
        hash.update(chunk);
        received += chunk.length;
      }
      return { chain, size: received, sha256: hash.digest('hex'), finalUrl: url };
    }
    throw new MirrorError('Too many redirects');
  };

  const candidates = (value) => {
    const found = findAsset(value);
    const urls = [];
    if (found?.browser_download_url && isRegistrableUrl(found.browser_download_url, { allowLocal })) {
      urls.push(found.browser_download_url);
    }
    if (isRegistrableUrl(apiDownloadUrl, { allowLocal })) urls.push(apiDownloadUrl);
    return urls;
  };

  const verify = async (value) => {
    const failures = [];
    for (const candidate of candidates(value)) {
      try {
        const result = await download(candidate);
        if (result.size !== size || result.sha256 !== sha256) {
          failures.push(
            `${new URL(candidate).host}: downloaded ${result.size} bytes sha256 ${result.sha256}, expected ${size} bytes sha256 ${sha256}`
          );
          continue;
        }
        return { downloadUrl: candidate, chain: result.chain };
      } catch (error) {
        failures.push(`${new URL(candidate).host}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { failures };
  };

  // 3. Reuse an identical upload, refuse to overwrite a different one, else upload.
  let verified;
  let reused = false;
  if (findAsset(release)) {
    log(`GitCode already has ${filename}; checking that it is identical`);
    verified = await verify(release);
    if (!verified.downloadUrl) {
      throw new MirrorError(
        `GitCode already has ${filename} but it cannot be verified as identical (${verified.failures.join('; ')}); ` +
          'not overwriting or deleting it'
      );
    }
    reused = true;
  } else {
    await withRetries('Uploading to GitCode', attempts, delayMs, async (attempt) => {
      log(`Uploading ${filename} (attempt ${attempt}/${attempts})`);
      const { response, text, json } = await api('GET', `${tagPath}/upload_url`, { query: { file_name: filename } });
      assertSuccess(response, 'Requesting the upload address', redact(text, secrets));
      const target = json();
      if (!target?.url) throw new Error('The upload address response has no url');
      const headers = { ...(target.headers ?? {}), 'content-length': String(size) };
      const put = await fetch(target.url, {
        method: 'PUT',
        headers,
        body: Readable.toWeb(createReadStream(apkPath)),
        duplex: 'half',
        signal: timeoutSignal(transferTimeoutMs),
      });
      const putText = await put.text();
      assertSuccess(put, 'Uploading the file', redact(putText, secrets));
    });
    // The upload is registered asynchronously through GitCode's callback.
    let refreshed = null;
    for (let poll = 0; poll < pollAttempts && !pastDeadline(); poll += 1) {
      refreshed = await fetchRelease();
      if (findAsset(refreshed)) break;
      await sleep(Math.min(pollIntervalMs, remaining()));
    }
    if (!findAsset(refreshed)) {
      throw new MirrorError('The uploaded file did not appear on the GitCode release');
    }
    verified = await verify(refreshed);
    if (!verified.downloadUrl) {
      throw new MirrorError(`The uploaded file failed the anonymous download check (${verified.failures.join('; ')})`);
    }
  }
  Object.assign(record, { reused, downloadUrl: verified.downloadUrl, redirectChain: verified.chain });

  // Informational: whether the mirror can resume downloads.
  try {
    const probe = await fetch(verified.downloadUrl, {
      headers: { range: 'bytes=0-0' },
      redirect: 'follow',
      signal: timeoutSignal(apiTimeoutMs),
    });
    record.acceptsRange = probe.status === 206;
    await probe.body?.cancel();
  } catch {
    record.acceptsRange = null;
  }

  // 4. Tell FlareRelease. It checks size and sha256 against the registered
  //    artifact and only then marks the mirror ready.
  const registration = {
    product: 'android',
    version,
    filename,
    provider: 'gitcode',
    downloadUrl: verified.downloadUrl,
    size,
    sha256,
    source,
  };
  const result = await withRetries('Registering the mirror with FlareRelease', attempts, delayMs, async () => {
    const response = await fetch(`${adminUrl}/api/mirrors`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'CF-Access-Client-Id': accessId,
        'CF-Access-Client-Secret': accessSecret,
      },
      body: JSON.stringify(registration),
      signal: timeoutSignal(apiTimeoutMs),
    });
    const text = await response.text();
    assertSuccess(response, 'FlareRelease', redact(text, secrets));
    return JSON.parse(text);
  });
  if (result?.data?.state !== 'ready') {
    throw new MirrorError(`FlareRelease did not mark the mirror ready: ${JSON.stringify(result).slice(0, 300)}`);
  }
  Object.assign(record, { status: 'mirrored', registeredAt: new Date().toISOString() });
  return record;
}

function writeOutputs(record, provenancePath, secrets) {
  const text = redact(`${JSON.stringify(record, null, 2)}\n`, secrets);
  if (provenancePath) {
    mkdirSync(dirname(resolve(provenancePath)), { recursive: true });
    writeFileSync(resolve(provenancePath), text);
  }
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const lines = [
      `### GitCode mirror: ${record.status}`,
      '',
      `- Tag: \`${record.tag}\``,
      `- File: \`${record.filename}\` (${record.size} bytes)`,
      `- SHA-256: \`${record.sha256}\``,
    ];
    if (record.downloadUrl) lines.push(`- Mirror: ${record.downloadUrl}`);
    if (record.error) lines.push(`- Reason: ${record.error}`);
    appendFileSync(summary, `${redact(lines.join('\n'), secrets)}\n`);
  }
}

async function main() {
  const log = (message) => console.log(redact(message, []));
  const missingConfig = argValue('--missing-config', 'fail');
  const allowLocal = hasFlag('--allow-local-http');
  const provenancePath = argValue('--provenance', undefined);
  const apkPath = argValue('--apk', undefined);
  const tag = argValue('--tag', undefined);
  if (!apkPath || !tag) throw new MirrorError('--apk and --tag are required');
  const version = argValue('--version', tag.replace(/^v/, ''));
  const source = argValue('--source', 'github-actions');
  const prerelease = argValue('--prerelease', 'false') === 'true';

  const env = process.env;
  const config = {
    apkPath: resolve(apkPath),
    tag,
    version,
    prerelease,
    source,
    token: env.GITCODE_TOKEN,
    owner: env.GITCODE_OWNER,
    repo: env.GITCODE_REPO,
    apiBase: (env.GITCODE_API_BASE || DEFAULT_API_BASE).replace(/\/$/, ''),
    adminUrl: (env.FLARE_RELEASE_ADMIN_URL || DEFAULT_ADMIN_URL).replace(/\/$/, ''),
    accessId: env.FLARE_RELEASE_ACCESS_CLIENT_ID,
    accessSecret: env.FLARE_RELEASE_ACCESS_CLIENT_SECRET,
    targetCommitish: env.GITCODE_TARGET_COMMITISH || 'main',
    allowLocal,
    attempts: numberArg('--attempts', 3),
    delayMs: numberArg('--retry-delay-ms', 5000),
    pollIntervalMs: numberArg('--poll-interval-ms', 3000),
    pollAttempts: numberArg('--poll-attempts', 20),
    apiTimeoutMs: numberArg('--api-timeout-ms', 60_000),
    // One bounded attempt for a ~100 MB transfer; the workflow also has a job timeout.
    transferTimeoutMs: numberArg('--transfer-timeout-ms', 600_000),
    // Must stay below the workflow step timeout (20 minutes).
    deadlineMs: numberArg('--deadline-ms', 1_080_000),
    log,
  };
  const secrets = [config.token, config.accessSecret, config.accessId];
  const base = { tag, version, filename: basename(config.apkPath), provider: 'gitcode', source };

  const missing = [
    ['GITCODE_TOKEN', config.token],
    ['GITCODE_OWNER', config.owner],
    ['GITCODE_REPO', config.repo],
    ['FLARE_RELEASE_ACCESS_CLIENT_ID', config.accessId],
    ['FLARE_RELEASE_ACCESS_CLIENT_SECRET', config.accessSecret],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    const reason = `GitCode mirroring is not configured; missing ${missing.join(', ')}`;
    const record = { ...base, size: statSync(config.apkPath).size, status: 'skipped', error: reason };
    console.log(`::warning title=GitCode mirror skipped::${reason}`);
    writeOutputs(record, provenancePath, secrets);
    process.exit(missingConfig === 'skip' ? 0 : 1);
  }

  if (!isRegistrableUrl(`${config.apiBase}/`, { allowLocal })) {
    throw new MirrorError('GITCODE_API_BASE must be an https GitCode or AtomGit address');
  }
  if (!allowLocal && !config.adminUrl.startsWith('https://')) {
    throw new MirrorError('FLARE_RELEASE_ADMIN_URL must be https');
  }

  try {
    const record = await mirrorApk(config);
    writeOutputs(record, provenancePath, secrets);
    console.log(redact(`Mirrored ${record.filename} to ${record.downloadUrl}`, secrets));
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const reason = redact(pastDeadline() && !/deadline/.test(raw) ? `deadline of ${config.deadlineMs} ms exceeded (${raw})` : raw, secrets);
    console.log(`::warning title=GitCode mirror failed::${reason}`);
    writeOutputs({ ...base, status: 'failed', error: reason }, provenancePath, secrets);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    const reason = redact(error instanceof Error ? error.message : String(error), [
      process.env.GITCODE_TOKEN,
      process.env.FLARE_RELEASE_ACCESS_CLIENT_SECRET,
    ]);
    console.log(`::warning title=GitCode mirror failed::${reason}`);
    console.error(`mirror-android-apk-to-gitcode failed: ${reason}`);
    process.exit(1);
  });
}
