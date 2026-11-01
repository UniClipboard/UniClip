#!/usr/bin/env python3
"""Run native admission with the real pinned macOS Engine and synthetic encrypted storage."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--target-dir', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--revision')
a = p.parse_args()
out = a.output.resolve()
out.mkdir(parents=True, exist_ok=True)
target = a.target_dir.resolve()
binding = target / 'uc-engine-uniffi-ios-package/bindings/uc_engine_uniffi.swift'
include = binding.parent / 'include'
if not binding.exists():
    binding = root / 'modules/uc-engine/ios/Bindings/uc_engine_uniffi.swift'
    include = root / 'modules/uc-engine/ios/UniClipboardEngine.xcframework/ios-arm64/Headers'
library = next((candidate for candidate in [target / 'debug/libuc_engine_uniffi.dylib', target / 'debug/deps/libuc_engine_uniffi.dylib'] if candidate.exists()), target / 'missing-library')
assert binding.exists() and library.exists(), 'Prepare the source-matched host binding and library first'
assert json.loads((root / 'modules/uc-engine/core-source.json').read_text())['sourceCommit'] == 'f3ffe490b30a82410400388a8dea10a76e71a82b'
fixture = (root / 'e2e/engine-settings/main.swift').read_text()
(out / 'IsolatedHost.swift').write_text('import Foundation\n' + fixture[fixture.index('final class IsolatedHost'):fixture.index('\nfunc run()')])
(out / 'main.swift').write_bytes((root / 'e2e/ios-resume-admission/real-engine.swift').read_bytes())
sources = []
for name in ['NativeLifecycleHost.swift', 'P2pRuntimeOwnership.swift', 'NativeRuntimeDiagnostics.swift']:
    relative = f'modules/uc-engine/ios/{name}'
    data = subprocess.check_output(['git', 'show', f'{a.revision}:{relative}'], cwd=root) if a.revision else (root / relative).read_bytes()
    staged = out / name
    staged.write_bytes(data)
    sources.append(staged)
command = ['xcrun', 'swiftc', '-I', str(include), '-L', str(library.parent), '-luc_engine_uniffi',
           '-Xlinker', '-rpath', '-Xlinker', str(library.parent), str(binding), *map(str, sources),
           str(out / 'IsolatedHost.swift'), str(out / 'main.swift'), '-o', str(out / 'real-host')]
receipt = {'revision': a.revision, 'scope': __doc__, 'commands': [], 'hashes': {str(f): hashlib.sha256(f.read_bytes()).hexdigest() for f in [binding, library, *sources]}}
for i, argv in enumerate([command, [str(out / 'real-host'), str(out)]]):
    with (out / f'command-{i}.log').open('w') as log:
        result = subprocess.run(argv, cwd=root, stdout=log, stderr=subprocess.STDOUT, timeout=180)
    receipt['commands'].append({'argv': argv, 'exitCode': result.returncode})
    if result.returncode:
        break
receipt['passed'] = len(receipt['commands']) == 2 and receipt['commands'][-1]['exitCode'] == 0
(out / 'commands.json').write_text(json.dumps(receipt, indent=2) + '\n')
print('Real Engine host:', 'PASS' if receipt['passed'] else 'FAIL')
raise SystemExit(0 if receipt['passed'] else 1)
