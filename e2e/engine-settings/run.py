#!/usr/bin/env python3
"""Compile and execute the generated Swift binding with an isolated Engine host."""
import argparse
import datetime
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--engine-source', type=pathlib.Path, required=True)
parser.add_argument('--platform', choices=['macos', 'ios-simulator'], default='macos')
parser.add_argument('--target-dir', type=pathlib.Path, required=True)
args = parser.parse_args()
source = args.engine_source.resolve()
target = args.target_dir.resolve()
results = ROOT / 'e2e/results'
results.mkdir(parents=True, exist_ok=True)
output = pathlib.Path(tempfile.mkdtemp(prefix='engine-settings-', dir=results))
receipt = {'started': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'commands': [], 'hashes': {}, 'hostPlatform': sys.platform, 'platform': args.platform,
           'scope': 'Swift UniFFI host; Engine restart within one process'}
device_id = None


def run(command):
    command = [str(item) for item in command]
    index = len(receipt['commands'])
    with (output / f'command-{index}.log').open('w') as log:
        try:
            result = subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, timeout=180)
        except subprocess.TimeoutExpired:
            receipt['commands'].append({'argv': command, 'exitCode': None,
                                        'timedOut': True, 'log': f'command-{index}.log'})
            raise RuntimeError(f'Command {index} exceeded 180 seconds') from None
    receipt['commands'].append({'argv': command, 'exitCode': result.returncode,
                                'log': f'command-{index}.log'})
    if result.returncode:
        raise RuntimeError(f'Command {index} failed with exit {result.returncode}')
    return (output / f'command-{index}.log').read_text()


def git(*command):
    return subprocess.check_output(['git', '-C', str(source), *command])


def digest(path):
    value = hashlib.file_digest(path.open('rb'), 'sha256').hexdigest()
    receipt['hashes'][str(path)] = value
    return value


try:
    if sys.platform != 'darwin':
        raise RuntimeError('This binding host requires macOS')
    pin = json.loads((ROOT / 'modules/uc-engine/core-source.json').read_text())
    receipt['enginePin'] = pin
    if pin['artifactSource'] != 'commit' or git('rev-parse', 'HEAD').decode().strip() != pin['sourceCommit']:
        raise RuntimeError('Engine source does not match the immutable commit pin')
    dirty = git('status', '--porcelain', '--untracked-files=no').decode().splitlines()
    if dirty:
        raise RuntimeError(f'Engine source has tracked changes: {dirty}')
    previous_pin = json.loads(subprocess.check_output(
        ['git', 'show', 'origin/main:modules/uc-engine/core-source.json'], cwd=ROOT))
    receipt['comparisonEngineCommit'] = previous_pin['sourceCommit']
    receipt['bindingAndLockDiff'] = git('diff', '--name-only', previous_pin['sourceCommit'],
                                      pin['sourceCommit'], '--', 'bindings', 'compatibility', 'Cargo.lock').decode().splitlines()
    run(['node', 'scripts/verify-unified-engine-core.mjs', '--prepared'])
    marker = ROOT / 'modules/uc-engine/.artifacts' / f"commit-{pin['sourceCommit']}" / 'prepared.json'
    receipt['preparedArtifacts'] = json.loads(marker.read_text())
    binding = ROOT / 'modules/uc-engine/ios/Bindings/uc_engine_uniffi.swift'
    staged = target / 'uc-engine-uniffi-ios-package/bindings'
    if digest(binding) != digest(staged / 'uc_engine_uniffi.swift'):
        raise RuntimeError('Prepared and build-stage Swift bindings differ')
    lockfile = source / 'Cargo.lock'
    if digest(lockfile) != hashlib.sha256(git('show', f"{pin['sourceCommit']}:Cargo.lock")).hexdigest():
        raise RuntimeError('Cargo.lock does not match the pinned source')
    library = target / 'debug/libuc_engine_uniffi.dylib'
    if args.platform == 'macos':
        digest(library)
    for file in [ROOT / 'e2e/engine-settings/main.swift', pathlib.Path(__file__).resolve(),
                 staged / 'include/uc_engine_uniffiFFI.h']:
        digest(file)
    executable = output / 'engine-settings-host'
    if args.platform == 'macos':
        run(['xcrun', 'swiftc', '-I', staged / 'include', '-L', target / 'debug',
             '-luc_engine_uniffi', '-Xlinker', '-rpath', '-Xlinker', target / 'debug',
             binding, ROOT / 'e2e/engine-settings/main.swift', '-o', executable])
    else:
        framework = ROOT / 'modules/uc-engine/ios/UniClipboardEngine.xcframework/ios-arm64_x86_64-simulator'
        digest(framework / 'libuc_engine_uniffi.a')
        sdk = run(['xcrun', '--sdk', 'iphonesimulator', '--show-sdk-path']).strip()
        run(['xcrun', '--sdk', 'iphonesimulator', 'swiftc', '-target', 'arm64-apple-ios16.4-simulator',
             '-sdk', sdk, '-I', framework / 'Headers', '-L', framework, '-luc_engine_uniffi',
             '-framework', 'Security', '-framework', 'SystemConfiguration', '-framework', 'Network',
             '-framework', 'UIKit', '-framework', 'UniformTypeIdentifiers', '-lc++', '-lresolv', '-lz',
             binding, ROOT / 'e2e/engine-settings/main.swift', '-o', executable])
        run(['codesign', '--force', '--sign', '-', executable])
    digest(executable)
    fixture = source / 'tests/upgrade-matrix/fixtures/desktop-0.19.4/profile/settings.json'
    digest(fixture)
    if args.platform == 'macos':
        run([executable, output, fixture])
    else:
        runtime = 'com.apple.CoreSimulator.SimRuntime.iOS-26-3'
        model = 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro'
        created = run(['xcrun', 'simctl', 'create', output.name, model, runtime]).strip()
        if not re.fullmatch(r'[A-Fa-f0-9-]{36}', created):
            raise RuntimeError('Simulator create returned an invalid identifier')
        device_id = created
        receipt['ownedSimulator'] = {'id': device_id, 'runtime': runtime, 'model': model}
        (output / 'owned-device.json').write_text(json.dumps(receipt['ownedSimulator'], indent=2) + '\n')
        run(['xcrun', 'simctl', 'boot', device_id])
        run(['xcrun', 'simctl', 'bootstatus', device_id, '-b'])
        run(['xcrun', 'simctl', 'spawn', device_id, executable, output, fixture])
    receipt['cases'] = json.loads((output / 'result.json').read_text())['cases']
    expected_cases = {'fresh', 'legacy', 'invalid-legacy', 'unsupportedFormat',
                      'malformedMarker', 'missingRuntimeMembers', 'receive-api'}
    if {case['case'] for case in receipt['cases']} != expected_cases or len(receipt['cases']) != 7:
        raise RuntimeError('The host did not execute all seven required cases')
    for file in sorted(output.glob('*/*.json')):
        digest(file)
    records = []
    for log in output.glob('observability/private/logs/engine.*.jsonl'):
        records.extend(json.loads(line) for line in log.read_text().splitlines() if line)
        digest(log)
    runtime_sources = sorted({row.get('source_commit') for row in records if row.get('source_commit')})
    receipt['runtimeSourceCommits'] = runtime_sources
    runtime_platforms = sorted({row.get('platform') for row in records if row.get('platform')})
    receipt['runtimePlatforms'] = runtime_platforms
    expected_platform = 'ios' if args.platform == 'ios-simulator' else 'macos'
    if runtime_platforms != [expected_platform]:
        raise RuntimeError('Running Engine does not report the requested native platform')
    if runtime_sources != [pin['sourceCommit']]:
        raise RuntimeError('Running Engine does not report the pinned source identity')
    receipt['passed'] = True
except Exception as error:
    receipt['passed'] = False
    receipt['error'] = str(error)
finally:
    if device_id:
        for operation in ['shutdown', 'delete']:
            try:
                run(['xcrun', 'simctl', operation, device_id])
            except Exception as cleanup_error:
                receipt.setdefault('cleanupErrors', []).append(str(cleanup_error))
                receipt['passed'] = False
    receipt['finished'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(output)
sys.exit(0 if receipt['passed'] else 1)
