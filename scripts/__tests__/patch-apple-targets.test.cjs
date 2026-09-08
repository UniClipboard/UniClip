const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { patchAppleTargets } = require('../patch-apple-targets.cjs');

test('the compatibility patch is repeatable and rejects unfamiliar source', () => {
  const source = fs.readFileSync(require.resolve('@bacons/apple-targets/build/with-xcode-changes.js'), 'utf8');
  const original = source
    .replace('        const previousConfigurationList = targetToUpdate.props.buildConfigurationList;\n', '')
    .replaceAll('previousConfigurationList', 'targetToUpdate.props.buildConfigurationList');
  const patched = patchAppleTargets(original);
  assert.notEqual(patched, original);
  assert.equal(patchAppleTargets(patched), patched);
  assert.throws(() => patchAppleTargets('unsupported'), /Unsupported/);
});

test('updating an existing extension retains its configuration list until removal completes', () => {
  const source = fs.readFileSync(require.resolve('@bacons/apple-targets/build/with-xcode-changes.js'), 'utf8');
  const start = source.indexOf('        // Remove existing build phases');
  const end = source.indexOf('\n    }\n    else {', start);
  assert.ok(start >= 0 && end > start);
  const target = { props: {} };
  let removed = false;
  const previous = {
    uuid: 'old-list', props: { buildConfigurations: [] },
    getReferrers: () => [{ removeReference: () => { delete target.props.buildConfigurationList; } }],
    removeFromProject: () => { removed = true; },
  };
  target.props.buildConfigurationList = previous;
  const replacement = { uuid: 'new-list' };
  new Function('targetToUpdate', 'project', 'props', 'configuration_list_1', source.slice(start, end))(
    target, {}, {}, { createConfigurationListForType: () => replacement }
  );
  assert.equal(removed, true);
  assert.equal(target.props.buildConfigurationList, replacement);
});
