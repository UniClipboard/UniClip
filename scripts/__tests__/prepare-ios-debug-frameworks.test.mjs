import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
test('restores actual Debug artifacts when the previous configuration marker is missing', t => {
 const temp = mkdtempSync(join(tmpdir(), 'ios-debug-frameworks-'));
 t.after(() => rmSync(temp, {recursive:true, force:true}));
 const pods = join(temp, 'Pods');
 const archive = join(pods, 'ReactNativeCore-artifacts');
 const fixture = join(temp, 'fixture/React.xcframework');
 mkdirSync(join(fixture, 'Modules'), {recursive:true});
 writeFileSync(join(fixture, 'Modules/module.modulemap'), 'module React {}');
 writeFileSync(join(fixture, 'configuration'), 'Debug');
 mkdirSync(archive, {recursive:true});
 const version = JSON.parse(readFileSync(join(root, 'node_modules/react-native/package.json'))).version;
 execFileSync('tar', ['-czf', join(archive, `reactnative-core-${version}-debug.tar.gz`), '-C', join(temp,'fixture'), 'React.xcframework']);
 const installed = join(pods, 'React-Core-prebuilt/React.xcframework');
 mkdirSync(installed, {recursive:true});
 writeFileSync(join(installed, 'configuration'), 'Release');
 // This is the upstream behaviour responsible for the observed link failure.
 execFileSync(process.execPath, [join(root,'node_modules/react-native/scripts/replace-rncore-version.js'), '-c','Debug','-r',version,'-p',pods], {cwd:pods});
 assert.equal(readFileSync(join(installed,'configuration'),'utf8'), 'Release');
 const result = spawnSync(process.execPath, [join(root,'scripts/prepare-ios-debug-frameworks.mjs'), pods], {encoding:'utf8'});
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert.equal(readFileSync(join(installed,'configuration'),'utf8'),'Debug');
 assert.equal(readFileSync(join(pods,'React-Core-prebuilt/.last_build_configuration'),'utf8'),'Debug');
 // A second preparation reuses the now-correct artifact, without needing its archive.
 rmSync(archive,{recursive:true});
 const again=spawnSync(process.execPath,[join(root,'scripts/prepare-ios-debug-frameworks.mjs'),pods],{encoding:'utf8'});
 assert.equal(again.status,0,again.stdout+again.stderr);
});
