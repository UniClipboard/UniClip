const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const {
  PATCH_FILE,
  SUPPORTED_VERSION,
  applySearchTabPatch,
} = require('../patch-react-native-screens-search-tab.cjs');

const PATCHED_FILES = [
  'ios/tabs/host/RNSTabBarController.h',
  'ios/tabs/host/RNSTabBarController.mm',
  'ios/tabs/RNSTabBarAppearanceCoordinator.mm',
];
const installedDir = path.dirname(require.resolve('react-native-screens/package.json'));

/** Copies the installed (patched) sources and reverses the patch to get the pristine package. */
function pristineCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rns-search-tab-'));
  for (const file of PATCHED_FILES) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.copyFileSync(path.join(installedDir, file), path.join(dir, file));
  }
  const reversed = spawnSync('patch', ['-p1', '--silent', '--reverse', '-i', PATCH_FILE], { cwd: dir });
  assert.equal(reversed.status, 0, 'installed react-native-screens must carry the UISearchTab patch');
  return dir;
}

test('the installed react-native-screens is the patched supported version', () => {
  const { version } = require('react-native-screens/package.json');
  assert.equal(version, SUPPORTED_VERSION);
  const controller = fs.readFileSync(path.join(installedDir, PATCHED_FILES[1]), 'utf8');
  assert.match(controller, /\[\[UISearchTab alloc\] initWithViewControllerProvider:provider\]/);
  assert.match(controller, /shouldSelectTab:\(UITab \*\)tab/);
});

test('the patch applies to pristine sources once and is repeatable', () => {
  const dir = pristineCopy();
  assert.doesNotMatch(fs.readFileSync(path.join(dir, PATCHED_FILES[1]), 'utf8'), /UISearchTab/);
  assert.equal(applySearchTabPatch(dir), 'applied');
  assert.equal(applySearchTabPatch(dir), 'already-applied');
  for (const file of PATCHED_FILES) {
    assert.equal(
      fs.readFileSync(path.join(dir, file), 'utf8'),
      fs.readFileSync(path.join(installedDir, file), 'utf8'),
      file
    );
  }
});

test('the patch rejects unfamiliar sources', () => {
  const dir = pristineCopy();
  fs.writeFileSync(path.join(dir, PATCHED_FILES[1]), '// unsupported\n');
  assert.throws(() => applySearchTabPatch(dir), /Unsupported/);
});

test('postinstall applies the patch', () => {
  const { scripts } = require('../../package.json');
  assert.match(scripts.postinstall, /node scripts\/patch-react-native-screens-search-tab\.cjs/);
});
