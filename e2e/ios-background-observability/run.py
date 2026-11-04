#!/usr/bin/env python3
"""Run the regular-mode background path with the real pinned process logger."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--binding', type=Path, required=True)
p.add_argument('--include', type=Path, required=True)
p.add_argument('--library', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--revision')
a = p.parse_args()
out = a.output.resolve()
out.mkdir(parents=True, exist_ok=False)

def read(path):
    if a.revision:
        return subprocess.check_output(['git', 'show', f'{a.revision}:{path}'], cwd=ROOT).decode()
    return (ROOT / path).read_text()

def declaration(source, marker):
    start = source.index(marker)
    at = source.index('{', start)
    depth = 1
    end = at + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]

native = read('modules/uc-engine/ios/UcEngineModule.swift')
initializer = native[native.index('  private lazy var lifecycle ='):native.index('  private lazy var hostSuspension =')]
initializer = initializer.replace('private lazy var', 'lazy var')
main = (ROOT / 'e2e/ios-background-observability/main.swift').read_text().replace('// PRODUCTION_LIFECYCLE_INITIALIZER', initializer)
pin = json.loads(read('modules/uc-engine/core-source.json'))
main = main.replace('__ENGINE_SOURCE_COMMIT__', pin['sourceCommit'])
fixed = 'releaseObservability:' in initializer
main = main.replace('// PRODUCTION_JOURNAL_BARRIER', 'return AppleNativeDiagnostics.journal.pause()' if fixed else '_ = AppleNativeDiagnostics.journal.flush()')
main = main.replace('// EXTRA_SCENARIOS', 'try realEngineScenario(module: module, queue: queue)\n  additionalScenarios()' if fixed else '')
sources = []
if fixed:
    sources.append(ROOT / 'e2e/ios-background-observability/scenarios.swift')
for name in ['NativeLifecycleHost.swift', 'P2pRuntimeOwnership.swift', 'NativeRuntimeDiagnostics.swift', 'NetworkLogHost.swift', 'NetworkLogExportStaging.swift']:
    target = out / name
    target.write_text(read('modules/uc-engine/ios/' + name))
    sources.append(target)
if fixed:
    target = out / 'AppleMobileEngineLifecycle.swift'
    target.write_text('import Foundation\n' + declaration(native, 'private final class AppleMobileEngineLifecycle').replace('private final class', 'final class', 1))
    sources.append(target)
    target = out / 'AppleProcessObservability.swift'
    target.write_text('import Foundation\n' + declaration(native, 'private enum AppleProcessObservability').replace('private enum', 'enum', 1))
    sources.append(target)
fixture = (ROOT / 'e2e/engine-settings/main.swift').read_text()
target = out / 'IsolatedHost.swift'
target.write_text('import Foundation\n' + fixture[fixture.index('final class IsolatedHost'):fixture.index('\nfunc run()')])
sources.append(target)
(out / 'main.swift').write_text(main)
sources.append(out / 'main.swift')
library = a.library.resolve()
binding = a.binding.resolve()
if hashlib.sha256(binding.read_bytes()).hexdigest() != pin['artifacts']['uc_engine_uniffi.swift']:
    raise RuntimeError('The Swift binding does not match the immutable Engine pin')
include = out / 'include'
include.mkdir()
shutil.copy2(a.include / 'uc_engine_uniffiFFI.h', include)
modulemap = a.include / 'module.modulemap'
if not modulemap.exists():
    modulemap = a.include / 'uc_engine_uniffiFFI.modulemap'
shutil.copy2(modulemap, include / 'module.modulemap')
receipt = {'revision': a.revision, 'enginePin': pin['sourceCommit'], 'passed': False, 'commands': [], 'hashes': {str(f): hashlib.sha256(f.read_bytes()).hexdigest() for f in [Path(__file__).resolve(), binding, library, include / 'uc_engine_uniffiFFI.h', include / 'module.modulemap', *sources]}}
commands = [
    ['xcrun', 'swiftc', '-I', str(include), '-L', str(library.parent), '-luc_engine_uniffi', '-Xlinker', '-rpath', '-Xlinker', str(library.parent), str(binding), *map(str, sources), '-o', str(out / 'host')],
    [str(out / 'host'), str(out)],
]
try:
    for i, command in enumerate(commands):
        with (out / f'command-{i}.log').open('w') as log:
            result = subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, timeout=180)
        receipt['commands'].append({'argv': command, 'exitCode': result.returncode})
        if result.returncode:
            break
    receipt['passed'] = len(receipt['commands']) == 2 and receipt['commands'][-1]['exitCode'] == 0
finally:
    (out / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(out)
raise SystemExit(0 if receipt['passed'] else 1)
