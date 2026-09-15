#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? resolve(import.meta.dirname, '..'));
const inputs = new Set();

function addFile(path) {
  if (existsSync(path)) inputs.add(resolve(path));
}

function addTree(path, include = () => true) {
  if (!existsSync(path)) return;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (!include(child)) continue;
    if (entry.isDirectory()) addTree(child, include);
    else addFile(child);
  }
}

for (const name of ['app.json', 'app.config.ts', 'package.json', 'package-lock.json']) {
  addFile(resolve(root, name));
}
for (const name of [
  'scripts/ios-native-input-fingerprint.mjs',
  'scripts/prepare-ios-development-project.sh',
  'scripts/prepare-ios-debug-frameworks.mjs',
]) {
  addFile(resolve(root, name));
}
for (const name of ['plugins', 'targets']) addTree(resolve(root, name));

const modulesRoot = resolve(root, 'modules');
if (existsSync(modulesRoot)) {
  for (const entry of readdirSync(modulesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const moduleRoot = resolve(modulesRoot, entry.name);
    addFile(resolve(moduleRoot, 'package.json'));
    addFile(resolve(moduleRoot, 'expo-module.config.json'));
    addTree(resolve(moduleRoot, 'ios'), (path) => {
      const name = relative(moduleRoot, path).replaceAll('\\', '/');
      if (entry.name !== 'uc-engine') return true;
      return (
        !name.startsWith('ios/UniClipboardEngine.xcframework') &&
        name !== 'ios/Bindings/uc_engine_uniffi.swift'
      );
    });
  }
}

const hash = createHash('sha256');
hash.update('uniclip-ios-native-inputs-v1\0');
for (const path of [...inputs].sort()) {
  const name = relative(root, path).replaceAll('\\', '/');
  const stat = lstatSync(path);
  hash.update(name);
  hash.update('\0');
  hash.update(stat.isSymbolicLink() ? readFileSync(path, 'utf8') : readFileSync(path));
  hash.update('\0');
}
process.stdout.write(`${hash.digest('hex')}\n`);
