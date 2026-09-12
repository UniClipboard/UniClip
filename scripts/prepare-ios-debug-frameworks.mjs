import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const reactRoot = dirname(require.resolve('react-native/package.json'));
const version = JSON.parse(readFileSync(join(reactRoot, 'package.json'), 'utf8')).version;
const podsRoot = resolve(process.argv[2] ?? join(import.meta.dirname, '../ios/Pods'));

for (const [directory, script] of [
  ['React-Core-prebuilt', 'scripts/replace-rncore-version.js'],
  ['ReactNativeDependencies', 'third-party-podspecs/replace_dependencies_version.js'],
]) {
  if (!existsSync(join(podsRoot, directory))) continue;
  const marker = join(podsRoot, directory, '.last_build_configuration');
  // RN otherwise assumes a missing marker means Debug, even if Release files remain.
  // Unknown forces its own version-switch script to extract the requested artifact.
  if (!existsSync(marker)) writeFileSync(marker, 'Unknown', { flag: 'wx' });
  execFileSync(process.execPath, [join(reactRoot, script), '-c', 'Debug', '-r', version, '-p', podsRoot], {
    cwd: podsRoot,
    stdio: 'inherit',
  });
}
