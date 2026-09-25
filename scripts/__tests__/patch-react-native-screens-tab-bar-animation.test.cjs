const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const {
  PATCH_FILE,
  SUPPORTED_VERSION,
  applyTabBarAnimationPatch,
} = require('../patch-react-native-screens-tab-bar-animation.cjs');

const PATCHED_FILE = 'ios/tabs/host/RNSTabsHostComponentView.mm';
const installedDir = path.dirname(require.resolve('react-native-screens/package.json'));

/** Copies the installed (patched) source and reverses the patch to get the pristine package. */
function pristineCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rns-tab-bar-animation-'));
  fs.mkdirSync(path.dirname(path.join(dir, PATCHED_FILE)), { recursive: true });
  fs.copyFileSync(path.join(installedDir, PATCHED_FILE), path.join(dir, PATCHED_FILE));
  const reversed = spawnSync('patch', ['-p1', '--silent', '--reverse', '-i', PATCH_FILE], { cwd: dir });
  assert.equal(reversed.status, 0, 'installed react-native-screens must carry the tab bar animation patch');
  return dir;
}

test('the installed react-native-screens animates tab bar visibility changes', () => {
  const { version } = require('react-native-screens/package.json');
  assert.equal(version, SUPPORTED_VERSION);
  const hostView = fs.readFileSync(path.join(installedDir, PATCHED_FILE), 'utf8');
  assert.match(hostView, /\[self applyTabBarHiddenSliding\];/);
  assert.match(hostView, /tabBar\.transform = hidden \? offscreen : CGAffineTransformIdentity;/);
  assert.doesNotMatch(hostView, /setTabBarHidden:_tabBarHidden animated:(NO|YES)/);
});

test('the patch applies to pristine sources once and is repeatable', () => {
  const dir = pristineCopy();
  assert.match(fs.readFileSync(path.join(dir, PATCHED_FILE), 'utf8'), /\[_controller setTabBarHidden:_tabBarHidden animated:NO\]/);
  assert.equal(applyTabBarAnimationPatch(dir), 'applied');
  assert.equal(applyTabBarAnimationPatch(dir), 'already-applied');
  assert.equal(
    fs.readFileSync(path.join(dir, PATCHED_FILE), 'utf8'),
    fs.readFileSync(path.join(installedDir, PATCHED_FILE), 'utf8')
  );
});

test('the patch rejects unfamiliar sources', () => {
  const dir = pristineCopy();
  fs.writeFileSync(path.join(dir, PATCHED_FILE), '// unsupported\n');
  assert.throws(() => applyTabBarAnimationPatch(dir), /Unsupported/);
});

test('postinstall applies the patch', () => {
  const { scripts } = require('../../package.json');
  assert.match(scripts.postinstall, /node scripts\/patch-react-native-screens-tab-bar-animation\.cjs/);
});
