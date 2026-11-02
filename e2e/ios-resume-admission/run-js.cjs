// Controlled adapter replay. This does not execute the native bridge or UIKit.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const out = path.resolve(process.argv[2]);
fs.mkdirSync(out, { recursive: true });
const source = 'src/features/sync/internal/p2pSyncAdapter.ts';
const moduleValue = { exports: {} };
const compiled = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(compiled, {
  exports: moduleValue.exports,
  require(name) {
    if (name === '@/support/observability') return { createLogger: () => ({ info() {}, error() {} }) };
    if (name === '@/features/transfer' || name === '@/utils/historyItemText') return {};
    throw new Error(`Unexpected runtime import: ${name}`);
  },
  setTimeout, clearTimeout,
});
const { P2pSyncAdapter } = moduleValue.exports;
const events = [];
const event = (name) => events.push({ event: name, monotonicNs: String(process.hrtime.bigint()) });
const results = [];
async function run(boundary) {
  let release, reached;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { reached = resolve; });
  let resumes = 0, reads = 0, notifications = 0;
  const adapter = new P2pSyncAdapter({ platform: 'ios', engine: {
    subscribeEvents() { return () => {}; },
    async start() { if (boundary === 'start') { reached(); await gate; } },
    async setBackgroundSyncPolicy() { event('policy.await'); if (boundary === 'policy') { reached(); await gate; } },
    async resume() { resumes++; event('resume.request'); if (boundary === 'resume') { reached(); await gate; } },
    async notifyConnectivityOpportunity() { notifications++; },
  }, space: { async refresh() { reads++; event('space.read'); if (boundary === 'space') { reached(); await gate; } return { devices: [] }; } } });
  const policy = { appState: 'active', backgroundSyncEnabled: false };
  const refresh = boundary === 'start' ? adapter.start({ policy, appVersion: 'test', profileId: 'test' }) : adapter.refresh(policy);
  await entered;
  adapter.handleAppStateChange({ appState: 'background', backgroundSyncEnabled: false });
  event(`background.at.${boundary}`); release(); await refresh;
  results.push({ scenario: `background-during-${boundary}`, passed: notifications === 0 &&
    (!['policy', 'start'].includes(boundary) || resumes === 0) && (boundary === 'space' || reads === 0), resumes, reads, notifications });
}
(async () => {
  for (const boundary of ['start', 'policy', 'resume', 'space']) await run(boundary);
  const receipt = { sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'), command: ['node', 'e2e/ios-resume-admission/run-js.cjs', process.argv[2]], scope: 'Actual transpiled adapter; controlled ports; no native bridge/UIKit', results, events,
    passed: results.every(result => result.passed) };
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(receipt, null, 2) + '\n');
  process.exitCode = receipt.passed ? 0 : 1;
})().catch(error => { console.error(error); process.exitCode = 2; });
