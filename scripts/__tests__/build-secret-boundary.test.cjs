const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const YAML = require('yaml');

const root = path.resolve(__dirname, '../..');
const names = ['adopt-engine-release', 'android-build', 'build-ios', 'ios-build-check', 'release'];

for (const name of names) {
  test(`${name}: dependency installation has no secrets or automatic scripts`, () => {
    const workflow = YAML.parse(fs.readFileSync(path.join(root, `.github/workflows/${name}.yml`), 'utf8'));
    for (const job of Object.values(workflow.jobs)) {
      let signingKeyWritten = false;
      for (const step of job.steps ?? []) {
        if (step.name === 'Write App Store Connect API key') signingKeyWritten = true;
        if (!/npm (ci|install)\b/.test(step.run ?? '')) continue;
        assert.match(step.run, /--ignore-scripts/);
        assert.doesNotMatch(JSON.stringify({ ...workflow.env, ...job.env, ...step.env }), /secrets\./);
        assert.equal(signingKeyWritten, false, 'install must precede signing key materialization');
      }
      const appInstall = (job.steps ?? []).findIndex((step) => step.run === 'npm ci --ignore-scripts');
      if (appInstall >= 0) {
        assert.equal(job.steps[appInstall + 1].run, 'npm run postinstall');
        assert.equal(job.steps[appInstall + 2].run, 'npm run prepare --workspaces --if-present');
      }
    }
  });
}
