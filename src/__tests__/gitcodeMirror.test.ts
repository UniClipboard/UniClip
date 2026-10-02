/// <reference types="node" />
/// <reference types="jest" />

import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const script = join(root, 'scripts', 'mirror-android-apk-to-gitcode.mjs');

const TOKEN = 'gitcode-secret-token-value';
const ACCESS_ID = 'access-client-id';
const ACCESS_SECRET = 'access-client-secret';
const TAG = 'v2.0.0.186';
const FILENAME = 'UniClip-2.0.0-arm64-v8a.apk';

type Behavior = {
  uploadFailures: number;
  uploadAlwaysFails: boolean;
  uploadHangs: boolean;
  corruptDownload: boolean;
  downloadRedirect: boolean;
  registrationFailures: number;
  registrationStatus: number;
};

type Fake = {
  port: number;
  stored: Map<string, Buffer>;
  requests: Array<{ method: string; url: string; headers: Record<string, string | undefined> }>;
  registrations: Array<Record<string, unknown>>;
  behavior: Behavior;
  close: () => Promise<void>;
};

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

async function startFake(overrides: Partial<Behavior> = {}): Promise<Fake> {
  const behavior: Behavior = {
    uploadFailures: 0,
    uploadAlwaysFails: false,
    uploadHangs: false,
    corruptDownload: false,
    downloadRedirect: false,
    registrationFailures: 0,
    registrationStatus: 200,
    ...overrides,
  };
  const stored = new Map<string, Buffer>();
  const requests: Fake['requests'] = [];
  const registrations: Array<Record<string, unknown>> = [];
  let release: { tag_name: string; assets: unknown[] } | null = null;
  let uploadAttempts = 0;
  let registrationAttempts = 0;
  let port = 0;

  const base = () => `http://127.0.0.1:${port}`;
  const assetList = () =>
    [...stored.keys()].map((name) => ({
      name,
      browser_download_url: `${base()}/o/r/releases/download/${TAG}/${name}`,
      type: 'attach',
      id: `id-${name}`,
    }));

  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', base());
    requests.push({
      method: request.method ?? 'GET',
      url: `${url.pathname}${url.search}`,
      headers: {
        authorization: request.headers.authorization,
        'cf-access-client-id': request.headers['cf-access-client-id'] as string | undefined,
        'cf-access-client-secret': request.headers['cf-access-client-secret'] as string | undefined,
      },
    });
    const path = url.pathname;
    const apiRelease = `/api/v5/repos/o/r/releases`;

    if (request.method === 'GET' && path === `${apiRelease}/tags/${TAG}`) {
      if (url.searchParams.get('access_token') !== TOKEN) return json(response, 401, {});
      if (!release) return json(response, 404, { error_message: 'Release not found' });
      return json(response, 200, { ...release, assets: assetList() });
    }
    if (request.method === 'POST' && path === apiRelease) {
      if (url.searchParams.get('access_token') !== TOKEN) return json(response, 401, {});
      const body = JSON.parse((await readBody(request)).toString('utf8'));
      release = { tag_name: body.tag_name, assets: [] };
      return json(response, 200, { ...release, ...body, assets: [] });
    }
    if (request.method === 'GET' && path === `${apiRelease}/${TAG}/upload_url`) {
      if (url.searchParams.get('access_token') !== TOKEN) return json(response, 401, {});
      const name = url.searchParams.get('file_name') ?? '';
      return json(response, 200, {
        url: `${base()}/obs/${encodeURIComponent(name)}`,
        headers: {
          'x-obs-acl': 'public-read',
          'x-obs-meta-project-id': '1',
          'Content-Type': 'application/octet-stream',
        },
      });
    }
    if (request.method === 'PUT' && path.startsWith('/obs/')) {
      const body = await readBody(request);
      uploadAttempts += 1;
      if (behavior.uploadHangs) return; // never answer, like a stalled transfer
      if (behavior.uploadAlwaysFails || uploadAttempts <= behavior.uploadFailures) {
        response.writeHead(500);
        return response.end('upload failed');
      }
      if (request.headers['x-obs-acl'] !== 'public-read') {
        response.writeHead(403);
        return response.end('missing required header');
      }
      stored.set(decodeURIComponent(path.slice('/obs/'.length)), body);
      response.writeHead(200);
      return response.end();
    }
    const direct =
      path.startsWith(`${apiRelease}/${TAG}/attach_files/`) && path.endsWith('/download')
        ? decodeURIComponent(path.slice(`${apiRelease}/${TAG}/attach_files/`.length, -'/download'.length))
        : path.startsWith(`/o/r/releases/download/${TAG}/`)
          ? decodeURIComponent(path.slice(`/o/r/releases/download/${TAG}/`.length))
          : path.startsWith('/dl/')
            ? decodeURIComponent(path.slice('/dl/'.length))
            : null;
    if (request.method === 'GET' && direct !== null) {
      const bytes = stored.get(direct);
      if (!bytes) {
        response.writeHead(404);
        return response.end();
      }
      if (behavior.downloadRedirect && !path.startsWith('/dl/')) {
        response.writeHead(302, { location: `${base()}/dl/${encodeURIComponent(direct)}` });
        return response.end();
      }
      const body = behavior.corruptDownload ? Buffer.concat([bytes.subarray(0, -1), Buffer.from([0])]) : bytes;
      const range = request.headers.range;
      if (range) {
        response.writeHead(206, { 'content-range': `bytes 0-0/${body.length}`, 'content-length': 1 });
        return response.end(body.subarray(0, 1));
      }
      response.writeHead(200, { 'content-length': body.length });
      return response.end(body);
    }
    if (request.method === 'PUT' && path === '/api/mirrors') {
      registrationAttempts += 1;
      if (
        request.headers['cf-access-client-id'] !== ACCESS_ID ||
        request.headers['cf-access-client-secret'] !== ACCESS_SECRET
      ) {
        return json(response, 401, { error: 'Cloudflare Access identity required' });
      }
      const body = JSON.parse((await readBody(request)).toString('utf8'));
      if (registrationAttempts <= behavior.registrationFailures) {
        return json(response, 503, { error: 'try later' });
      }
      if (behavior.registrationStatus !== 200) {
        return json(response, behavior.registrationStatus, { error: 'Mirror sha256 does not match the artifact' });
      }
      registrations.push(body);
      return json(response, 200, { data: { state: 'ready', ...body } });
    }
    response.writeHead(404);
    response.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  return {
    get port() {
      return port;
    },
    stored,
    requests,
    registrations,
    behavior,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  } as Fake;
}

type Result = { code: number; stdout: string; stderr: string };

function run(args: string[], env: Record<string, string | undefined>): Promise<Result> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [script, ...args],
      {
        env: Object.fromEntries(
          Object.entries({ PATH: process.env.PATH, ...env }).filter(([, value]) => value !== undefined)
        ) as NodeJS.ProcessEnv,
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const code = error ? ((error as NodeJS.ErrnoException & { code?: number }).code as number) : 0;
        resolve({ code: typeof code === 'number' ? code : 1, stdout, stderr });
      }
    );
  });
}

describe('GitCode APK mirror upload', () => {
  const dirs: string[] = [];
  const servers: Fake[] = [];
  const apk = randomBytes(2 * 1024 * 1024 + 17);
  const sha256 = createHash('sha256').update(apk).digest('hex');

  afterEach(async () => {
    for (const server of servers.splice(0)) await server.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  async function setup(overrides: Partial<Behavior> = {}) {
    const fake = await startFake(overrides);
    servers.push(fake);
    const dir = mkdtempSync(join(tmpdir(), 'gitcode-mirror-'));
    dirs.push(dir);
    const apkPath = join(dir, FILENAME);
    writeFileSync(apkPath, apk);
    const provenance = join(dir, 'provenance.json');
    const args = [
      '--apk',
      apkPath,
      '--tag',
      TAG,
      '--prerelease',
      'false',
      '--source',
      'github-actions:UniClipboard/UniClip:1',
      '--provenance',
      provenance,
      '--allow-local-http',
      '--retry-delay-ms',
      '1',
      '--poll-interval-ms',
      '1',
    ];
    const env = {
      GITCODE_TOKEN: TOKEN,
      GITCODE_OWNER: 'o',
      GITCODE_REPO: 'r',
      GITCODE_API_BASE: `http://127.0.0.1:${fake.port}/api/v5`,
      FLARE_RELEASE_ADMIN_URL: `http://127.0.0.1:${fake.port}`,
      FLARE_RELEASE_ACCESS_CLIENT_ID: ACCESS_ID,
      FLARE_RELEASE_ACCESS_CLIENT_SECRET: ACCESS_SECRET,
    };
    return {
      fake,
      args,
      env,
      provenance: () => JSON.parse(readFileSync(provenance, 'utf8')) as Record<string, unknown>,
    };
  }

  const putCount = (fake: Fake) => fake.requests.filter((r) => r.method === 'PUT' && r.url.startsWith('/obs/')).length;

  it('uploads the exact signed bytes, verifies an anonymous download and registers the mirror', async () => {
    const { fake, args, env, provenance } = await setup();
    const result = await run(args, env);
    expect(result.code).toBe(0);
    expect(fake.stored.get(FILENAME)?.equals(apk)).toBe(true);
    expect(fake.registrations).toHaveLength(1);
    expect(fake.registrations[0]).toMatchObject({
      product: 'android',
      version: '2.0.0.186',
      filename: FILENAME,
      provider: 'gitcode',
      size: apk.length,
      sha256,
      source: 'github-actions:UniClipboard/UniClip:1',
    });
    expect(String(fake.registrations[0]?.downloadUrl)).toContain(`/o/r/releases/download/${TAG}/${FILENAME}`);
    const record = provenance();
    expect(record).toMatchObject({ status: 'mirrored', tag: TAG, filename: FILENAME, size: apk.length, sha256 });
    // Never leak the token into logs or artifacts.
    expect(JSON.stringify(record) + result.stdout + result.stderr).not.toContain(TOKEN);
    expect(JSON.stringify(record) + result.stdout + result.stderr).not.toContain(ACCESS_SECRET);
  });

  it('verifies the download without any credential', async () => {
    const { fake, args, env } = await setup();
    await run(args, env);
    const downloads = fake.requests.filter((r) => r.method === 'GET' && r.url.includes('/releases/download/'));
    expect(downloads.length).toBeGreaterThan(0);
    for (const download of downloads) {
      expect(download.url).not.toContain('access_token');
      expect(download.headers.authorization).toBeUndefined();
    }
  });

  it('follows download redirects and records the chain', async () => {
    const { args, env, provenance } = await setup({ downloadRedirect: true });
    const result = await run(args, env);
    expect(result.code).toBe(0);
    expect(JSON.stringify(provenance().redirectChain)).toContain('/dl/');
  });

  it('is idempotent: a rerun reuses the uploaded file and registers again', async () => {
    const { fake, args, env } = await setup();
    expect((await run(args, env)).code).toBe(0);
    expect((await run(args, env)).code).toBe(0);
    expect(putCount(fake)).toBe(1);
    expect(fake.registrations).toHaveLength(2);
    expect(fake.requests.filter((r) => r.method === 'POST' && r.url.startsWith('/api/v5/repos/o/r/releases'))).toHaveLength(1);
  });

  it('refuses to touch an existing file whose bytes differ', async () => {
    const { fake, args, env, provenance } = await setup();
    await run(args, env);
    fake.stored.set(FILENAME, randomBytes(64));
    fake.registrations.length = 0;
    const before = putCount(fake);
    const result = await run(args, env);
    expect(result.code).toBe(1);
    expect(putCount(fake)).toBe(before);
    expect(fake.registrations).toHaveLength(0);
    expect(fake.requests.some((r) => r.method === 'DELETE')).toBe(false);
    expect(provenance()).toMatchObject({ status: 'failed' });
  });

  it('retries a failed upload with a fresh upload address', async () => {
    const { fake, args, env } = await setup({ uploadFailures: 2 });
    const result = await run(args, env);
    expect(result.code).toBe(0);
    expect(putCount(fake)).toBe(3);
    expect(fake.requests.filter((r) => r.url.includes('/upload_url'))).toHaveLength(3);
  });

  it('fails visibly, without registering, when the upload keeps failing', async () => {
    const { fake, args, env, provenance } = await setup({ uploadAlwaysFails: true });
    const result = await run(args, env);
    expect(result.code).toBe(1);
    expect(putCount(fake)).toBeLessThanOrEqual(3);
    expect(fake.registrations).toHaveLength(0);
    expect(result.stdout + result.stderr).toMatch(/::warning/);
    expect(provenance()).toMatchObject({ status: 'failed' });
    expect(result.stdout + result.stderr).not.toContain(TOKEN);
  });

  it('gives up at its own deadline when GitCode stalls, so the job timeout is never reached', async () => {
    const { fake, args, env, provenance } = await setup({ uploadHangs: true });
    const started = Date.now();
    const result = await run([...args, '--deadline-ms', '1500', '--transfer-timeout-ms', '600000'], env);
    expect(result.code).toBe(1);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(fake.registrations).toHaveLength(0);
    expect(result.stdout + result.stderr).toMatch(/::warning/);
    expect(provenance()).toMatchObject({ status: 'failed' });
    expect(String(provenance().error)).toMatch(/deadline|timed out|aborted/i);
  });

  it('does not register a mirror whose downloaded bytes differ from the APK', async () => {
    const { fake, args, env, provenance } = await setup({ corruptDownload: true });
    const result = await run(args, env);
    expect(result.code).toBe(1);
    expect(fake.registrations).toHaveLength(0);
    expect(String(provenance().error)).toMatch(/sha256|size/i);
  });

  it('retries a temporarily unavailable FlareRelease and reports a rejected registration', async () => {
    const flaky = await setup({ registrationFailures: 1 });
    expect((await run(flaky.args, flaky.env)).code).toBe(0);
    expect(flaky.fake.registrations).toHaveLength(1);

    const rejected = await setup({ registrationStatus: 422 });
    const result = await run(rejected.args, rejected.env);
    expect(result.code).toBe(1);
    expect(rejected.provenance()).toMatchObject({ status: 'failed' });
    expect(String(rejected.provenance().error)).toContain('422');
  });

  it('skips with a warning when GitCode is not configured, or fails when asked to', async () => {
    const { fake, args, env, provenance } = await setup();
    const unconfigured = { ...env, GITCODE_TOKEN: undefined, GITCODE_OWNER: undefined };
    const skipped = await run([...args, '--missing-config', 'skip'], unconfigured);
    expect(skipped.code).toBe(0);
    expect(skipped.stdout + skipped.stderr).toMatch(/::warning/);
    expect(provenance()).toMatchObject({ status: 'skipped' });
    expect(String(provenance().error ?? '')).toContain('GITCODE_TOKEN');
    expect(fake.requests).toHaveLength(0);

    const failed = await run([...args, '--missing-config', 'fail'], unconfigured);
    expect(failed.code).toBe(1);
    expect(fake.requests).toHaveLength(0);
  });

  it('only accepts https GitCode addresses outside local testing', async () => {
    const { fake, args, env } = await setup();
    const result = await run(
      args.filter((arg) => arg !== '--allow-local-http'),
      env
    );
    expect(result.code).toBe(1);
    expect(fake.requests).toHaveLength(0);
  });
});
