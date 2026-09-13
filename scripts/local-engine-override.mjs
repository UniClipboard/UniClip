#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const config = resolve(root, 'modules/uc-engine/.artifacts/local/source.json');
const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error('Usage: npm run core:patch -- <engine-directory> | npm run core:unpatch');
  process.exit(2);
}
if (args[0] === '--clear') {
  rmSync(config, { force: true });
  console.log('Local Engine override cleared. Development installs will use the project version.');
} else {
  const repository = realpathSync(resolve(args[0]));
  for (const file of ['Cargo.toml', 'crates/uc-engine/Cargo.toml',
    'bindings/uc-engine-uniffi/scripts/build-ios-xcframework.sh',
    'bindings/uc-engine-uniffi/scripts/build-android-aar.sh']) {
    if (!existsSync(resolve(repository, file))) throw new Error(`Missing Engine file: ${file}`);
  }
  execFileSync('git', ['-C', repository, 'rev-parse', '--verify', 'HEAD'], { stdio: 'pipe' });
  mkdirSync(dirname(config), { recursive: true });
  writeFileSync(config, `${JSON.stringify({ repository }, null, 2)}\n`);
  console.log(`Development installs will use the current files in ${repository}`);
  console.log('The project Engine version is unchanged. Run npm run core:unpatch to clear.');
}
