/// <reference types="node" />
/// <reference types="jest" />

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const wrapper = join(root, 'scripts', 'remote', 'gitcode-mirror-host.py');

const TAG = 'v2.0.0.186';
const FILENAME = 'UniClip-2.0.0-arm64-v8a.apk';

// What the wrapper runs in place of the real upload script: it reports what it was
// given so the tests can check the contract between CI and the mirror host.
const stubScript = `
import fs from 'node:fs';
const args = process.argv.slice(2);
const apk = args[args.indexOf('--apk') + 1];
console.log('STUB ' + JSON.stringify({
  args,
  apkBytes: fs.statSync(apk).size,
  apkPath: apk,
  env: Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(GITCODE|FLARE_RELEASE)_/.test(k) || k === 'LD_PRELOAD')),
}));
const out = args[args.indexOf('--provenance') + 1];
fs.writeFileSync(out, JSON.stringify({ status: 'mirrored', tag: args[args.indexOf('--tag') + 1] }));
process.exit(Number(process.env.STUB_EXIT || 0));
`;

describe('GitCode mirror host wrapper', () => {
  const apk = randomBytes(300 * 1024 + 7);
  const sha256 = createHash('sha256').update(apk).digest('hex');
  let server: Server;
  let base: string;
  const downloads: string[] = [];
  let work: string;

  beforeEach(async () => {
    work = mkdtempSync(join(tmpdir(), 'mirror-host-'));
    downloads.length = 0;
    server = createServer((request, response) => {
      downloads.push(request.url ?? '');
      if (request.url === `/android/artifacts/${TAG}/${FILENAME}`) {
        response.writeHead(200, { 'content-length': apk.length });
        return response.end(apk);
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    rmSync(work, { recursive: true, force: true });
  });

  type Request = {
    tag?: string;
    filename?: string;
    expectSha256?: string;
    scriptSha256?: string;
    prerelease?: boolean;
    source?: string;
    env?: Record<string, string>;
  };

  // The upload script is installed on the host by a maintainer; CI only names the
  // digest of the version it expects. Nothing but one JSON line is ever read.
  function run(
    request: Request,
    options: { script?: string; trailing?: string; omitScriptFile?: boolean } = {}
  ) {
    const script = options.script ?? stubScript;
    const installed = join(mkdtempSync(join(tmpdir(), 'mirror-installed-')), 'mirror.mjs');
    if (!options.omitScriptFile) writeFileSync(installed, script);
    return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      const child = spawn('python3', [wrapper], {
        env: {
          PATH: process.env.PATH,
          UNICLIP_MIRROR_R2_BASE: base,
          UNICLIP_MIRROR_NODE: process.execPath,
          UNICLIP_MIRROR_TMP: work,
          UNICLIP_MIRROR_SCRIPT: installed,
        },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.on('close', (code) => {
        rmSync(join(installed, '..'), { recursive: true, force: true });
        resolve({ code: code ?? 1, stdout, stderr });
      });
      const header = {
        tag: TAG,
        filename: FILENAME,
        expectSha256: sha256,
        scriptSha256: createHash('sha256').update(script).digest('hex'),
        prerelease: false,
        source: 'github-actions:UniClipboard/UniClip:1',
        env: { GITCODE_TOKEN: 'tok-secret', GITCODE_OWNER: 'o', GITCODE_REPO: 'r' },
        ...request,
      };
      child.stdin.end(`${JSON.stringify(header)}\n${options.trailing ?? ''}`);
    });
  }

  const stubReport = (stdout: string) => JSON.parse(/STUB (.*)/.exec(stdout)?.[1] ?? 'null');

  it('downloads the APK from R2, verifies it, runs the script and hands back the provenance', async () => {
    const result = await run({});
    expect(result.code).toBe(0);
    const report = stubReport(result.stdout);
    expect(report.apkBytes).toBe(apk.length);
    expect(report.args).toEqual(expect.arrayContaining(['--tag', TAG, '--source', 'github-actions:UniClipboard/UniClip:1']));
    expect(report.args).toEqual(expect.arrayContaining(['--expect-sha256', sha256, '--missing-config', 'fail']));
    expect(report.env).toMatchObject({ GITCODE_TOKEN: 'tok-secret', GITCODE_OWNER: 'o', GITCODE_REPO: 'r' });
    expect(result.stdout).toContain('::provenance::');
    expect(result.stdout).toMatch(/::provenance::\{"status": ?"mirrored"/);
    // The R2 download is the only network access of the wrapper itself.
    expect(downloads).toEqual([`/android/artifacts/${TAG}/${FILENAME}`]);
  });

  it('passes the prerelease flag and removes everything it created', async () => {
    const result = await run({ prerelease: true });
    expect(stubReport(result.stdout).args).toEqual(expect.arrayContaining(['--prerelease', 'true']));
    expect(existsSync(stubReport(result.stdout).apkPath)).toBe(false);
    expect(readdirSync(work)).toEqual([]);
  });

  it('refuses a download whose SHA-256 is not the expected one and never runs the script', async () => {
    const result = await run({ expectSha256: '0'.repeat(64) });
    expect(result.code).not.toBe(0);
    expect(result.stdout).not.toContain('STUB');
    expect(result.stdout + result.stderr).toMatch(/sha256/i);
    expect(readdirSync(work)).toEqual([]);
  });

  it('fails when the file cannot be downloaded', async () => {
    const result = await run({ tag: 'v9.9.9.999' });
    expect(result.code).not.toBe(0);
    expect(result.stdout).not.toContain('STUB');
  });

  it('rejects anything that is not a plain release tag, APK name and digest', async () => {
    for (const bad of [
      { tag: '../etc' },
      { tag: 'v1; rm -rf /' },
      { filename: '../../x.apk' },
      { filename: 'UniClip-2.0.0-arm64-v8a.sh' },
      { expectSha256: 'abc' },
    ]) {
      const result = await run(bad);
      expect(result.code).not.toBe(0);
      expect(result.stdout).not.toContain('STUB');
    }
    expect(downloads).toEqual([]);
  });

  it('only forwards the settings of the upload script, never other environment variables', async () => {
    const result = await run({ env: { GITCODE_TOKEN: 't', LD_PRELOAD: '/tmp/evil.so' } });
    expect(result.code).not.toBe(0);
    expect(result.stdout).not.toContain('STUB');
    expect(result.stdout + result.stderr).toMatch(/LD_PRELOAD/);
  });

  it('returns the exit status of the upload script and never echoes the secrets', async () => {
    const result = await run({}, { script: stubScript.replace('process.exit(Number(process.env.STUB_EXIT || 0))', 'process.exit(3)') });
    expect(result.code).toBe(3);
    expect((result.stdout + result.stderr).replace(/STUB .*/, '')).not.toContain('tok-secret');
  });

  it('never runs code that arrives over the SSH session', async () => {
    const result = await run({}, { trailing: "console.log('STUB injected');" });
    expect(result.code).not.toBe(0);
    expect(result.stdout).not.toContain('STUB');
    expect(result.stdout + result.stderr).toMatch(/unexpected data|only the request/i);
    expect(downloads).toEqual([]);
  });

  it('refuses to run an installed script other than the version CI expects', async () => {
    const result = await run({ scriptSha256: '1'.repeat(64) });
    expect(result.code).not.toBe(0);
    expect(result.stdout).not.toContain('STUB');
    expect(result.stdout + result.stderr).toMatch(/out of date|scriptSha256/i);
    expect(downloads).toEqual([]);
    const missing = await run({ scriptSha256: undefined as unknown as string });
    expect(missing.code).not.toBe(0);
  });

  it('fails clearly when the script is not installed on the host', async () => {
    const result = await run({}, { omitScriptFile: true });
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/not installed|no such file/i);
    expect(downloads).toEqual([]);
  });
});
