#!/usr/bin/env python3
"""Build/typecheck host ownership code without launching any app or device."""
import argparse, datetime, hashlib, json, pathlib, shutil, subprocess
root = pathlib.Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base-ref', default='fcf68bfe917fc7a12a3c0696ac90b5463ae0b724')
parser.add_argument('--output-root', type=pathlib.Path, default=root/'e2e/results/ios-suspension')
args = parser.parse_args()
out = args.output_root.resolve()/('build-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
out.mkdir(parents=True)
record = {'scope': 'nonvisual host build, iOS SDK storage typecheck, Swift syntax, existing storage E2E and TypeScript; no full UIKit/Expo app or Engine build', 'commands': [], 'sourceHashes': {}}
base = subprocess.check_output(['git', 'merge-base', args.base_ref, 'HEAD'], cwd=root, text=True).strip()
record['baseCommit'] = base
record['headCommit'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
changed = subprocess.check_output(['git', 'diff', '--name-only', '-z', '--diff-filter=d', base], cwd=root).decode().split('\0')
changed += subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', '-z'], cwd=root).decode().split('\0')
changed = sorted({name for name in changed if name and (root/name).is_file()})
for name in changed + ['modules/app-group-store/ios/Shared/SharedStorageAccess.swift']:
    if (root/name).is_file(): record['sourceHashes'][name] = hashlib.sha256((root/name).read_bytes()).hexdigest()

def run(name, command):
    try:
        result = subprocess.run([str(x) for x in command], cwd=root, capture_output=True, timeout=60)
        code, stdout, stderr = result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired as error:
        code, stdout, stderr = 124, error.stdout or b'', error.stderr or b''
    (out/(name+'.stdout.txt')).write_bytes(stdout); (out/(name+'.stderr.txt')).write_bytes(stderr)
    record['commands'].append({'name': name, 'argv': [str(x) for x in command], 'exitCode': code})
    print(name, code, flush=True)
    return code

run('native-host', ['swift','build','--package-path',root/'modules/uc-engine','--scratch-path',out/'host-build','--target','UcEngineSystemHost'])
run('extension-history', ['bash',root/'scripts/check-extension-history-behavior.sh',out/'extension-history'])
run('share-staging', ['bash',root/'scripts/check-share-staging-behavior.sh'])
run('typescript', ['node',root/'node_modules/typescript/bin/tsc','--noEmit'])
for name, spec in [('storage','AppGroupStore'),('core','UcEngineCore'),('module','UcEngine')]:
    directory = 'modules/app-group-store/ios' if name=='storage' else 'modules/uc-engine/ios'
    run('podspec-'+name, ['pod','ipc','spec',root/directory/(spec+'.podspec')])
run('swift-parse', ['xcrun','swiftc','-frontend','-parse'] + [root/f for f in changed if f.endswith('.swift')])
sdk = subprocess.check_output(['xcrun','--sdk','iphoneos','--show-sdk-path'],text=True).strip()
stage = out/'ios-modules'; stage.mkdir()
compiler = ['xcrun','swiftc','-swift-version','5','-sdk',sdk,'-target','arm64-apple-ios16.4','-module-cache-path',stage/'module-cache']
run('ios-storage-module', compiler+['-parse-as-library','-emit-module','-module-name','AppGroupStore',root/'modules/app-group-store/ios/Shared/SharedStorageAccess.swift','-emit-module-path',stage/'AppGroupStore.swiftmodule'])
provider = stage/'ExpoModulesProvider.swift'
provider.write_text('internal import AppGroupStore\n')
record['providerFixture'] = {'source': provider.read_text(), 'sha256': hashlib.sha256(provider.read_bytes()).hexdigest()}
sharedFiles = list((root/'targets/_shared').glob('*.swift')) + [root/'modules/uc-engine/ios/NativeRuntimeDiagnostics.swift']
run('ios-storage-typecheck', compiler+['-typecheck','-parse-as-library','-I',stage,'-module-name','SuspensionStorageCheck',provider]+sharedFiles)
hostFiles = [root/'modules/uc-engine/ios'/name for name in ['NativeRuntimeDiagnostics.swift','P2pRuntimeOwnership.swift','ExtensionRuntimeLifecycle.swift','NativeLifecycleHost.swift']]
run('ios-native-host-typecheck', compiler+['-typecheck','-parse-as-library','-I',stage,'-module-name','SuspensionHostCheck']+hostFiles)
record['result'] = 'PASS' if all(c['exitCode']==0 for c in record['commands']) else 'FAIL'
(out/'result.json').write_text(json.dumps(record,indent=2)+'\n')
print(out); print(record['result'])
raise SystemExit(0 if record['result']=='PASS' else 1)
