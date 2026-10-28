#!/usr/bin/env python3
"""Run actual Swift bridge mapper bodies and generated bindings with a temporary host."""
import argparse, hashlib, json, pathlib, subprocess
root = pathlib.Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--target-dir', type=pathlib.Path, required=True)
p.add_argument('--output', type=pathlib.Path, required=True)
a = p.parse_args()
out = a.output.resolve(); out.mkdir(parents=True, exist_ok=True)
target = a.target_dir.resolve()
bindings = target / 'uc-engine-uniffi-ios-package/bindings'
if (bindings/'uc_engine_uniffi.swift').exists():
    binding_file = bindings/'uc_engine_uniffi.swift'
    include = bindings/'include'
else:
    binding_file = root/'modules/uc-engine/ios/Bindings/uc_engine_uniffi.swift'
    include = root/'modules/uc-engine/ios/UniClipboardEngine.xcframework/ios-arm64/Headers'
library = next((f for f in [target/'debug/libuc_engine_uniffi.dylib', target/'debug/deps/libuc_engine_uniffi.dylib'] if f.exists()), None)
if library is None:
    raise RuntimeError('Build the source-matched macOS UniFFI host library first')
pin = json.loads((root / 'modules/uc-engine/core-source.json').read_text())
if pin['sourceCommit'] != '80bda137541f1a054897f8d1474634dac9d752e8':
    raise RuntimeError('This replay requires the audited immutable Engine source')
if binding_file.read_bytes() != (root/'modules/uc-engine/ios/Bindings/uc_engine_uniffi.swift').read_bytes():
    raise RuntimeError('Staged and prepared bindings differ')
source = (root / 'modules/uc-engine/ios/UcEngineModule.swift').read_text()
def method(name):
    start = source.index('  private static func ' + name)
    at = source.index('{', start); level = 1; end = at + 1
    while level:
        if source[end] == '{': level += 1
        elif source[end] == '}': level -= 1
        end += 1
    return source[start:end].replace('private static func', 'static func')
mapper = 'import Foundation\nenum BridgeReplay {\n' + '\n'.join(method(n) for n in ['outboundProgressMap', 'resendTargetProgressMap', 'resendOutcomeMap', 'engineResult', 'engineFailureMap']) + '\n}\n'
(out / 'BridgeReplay.swift').write_text(mapper)
host = (root / 'e2e/engine-settings/main.swift').read_text()
(out / 'IsolatedHost.swift').write_text('import Foundation\n' + host[host.index('final class IsolatedHost'):host.index('\nfunc run()')])
(out / 'main.swift').write_text((root / 'e2e/outbound-progress/native-host.swift').read_text())
commands = [
 ['xcrun','swiftc','-I',str(include),'-L',str(library.parent),'-luc_engine_uniffi','-Xlinker','-rpath','-Xlinker',str(library.parent),str(binding_file),str(out/'BridgeReplay.swift'),str(out/'IsolatedHost.swift'),str(out/'main.swift'),'-o',str(out/'native-replay')],
 [str(out/'native-replay'),str(out)]
]
receipt = {'scope':'nonvisual macOS host and actual copied bridge methods', 'commands':[], 'hashes':{}}
try:
 for i, command in enumerate(commands):
    with (out/f'command-{i}.log').open('w') as log:
        r = subprocess.run(command,cwd=root,stdout=log,stderr=subprocess.STDOUT,timeout=180)
    receipt['commands'].append({'argv':command,'exitCode':r.returncode})
    if r.returncode: raise RuntimeError(f'command {i} failed; inspect command-{i}.log')
 for file in [root/'modules/uc-engine/ios/UcEngineModule.swift',binding_file,library,out/'native-replay',out/'BridgeReplay.swift']:
    with file.open('rb') as stream: receipt['hashes'][str(file)] = hashlib.file_digest(stream,'sha256').hexdigest()
 receipt['passed']=True
finally:
 (out/'commands.json').write_text(json.dumps(receipt,indent=2)+'\n')
