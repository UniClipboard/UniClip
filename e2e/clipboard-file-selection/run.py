#!/usr/bin/env python3
"""Compile production clipboard writer bodies against in-memory OS boundaries."""
import argparse
import hashlib
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--output', type=pathlib.Path, required=True)
p.add_argument('--source-ref', help='Read production source from this immutable Git revision')
a = p.parse_args()
out = a.output.resolve()
out.mkdir(parents=True, exist_ok=True)

def read_source(file):
    if a.source_ref:
        return subprocess.check_output(['git', 'show', f'{a.source_ref}:{file.relative_to(ROOT)}'], cwd=ROOT, text=True)
    return file.read_text()


def block(source, marker):
    start = source.index(marker)
    opening = source.index('{', start)
    level = 1
    end = opening + 1
    while level:
        if source[end] == '{': level += 1
        elif source[end] == '}': level -= 1
        end += 1
    return source[start:end]

host = ROOT / 'modules/uc-engine/ios/SharedEngineHost.swift'
helpers = ROOT / 'modules/uc-engine/ios/NativeSystemHost.swift'
support = read_source(helpers)
production = '\n'.join(block(support, marker) for marker in [
    'struct AppleClipboardDisplayMetadata:', 'struct AppleClipboardFileSelection {',
    'enum AppleClipboardFileResolver {', 'final class AppleClipboardShareCache {'])
method = block(read_source(host), '  func clipboardWrite(snapshot:')
main = (ROOT / 'e2e/clipboard-file-selection/host.swift').read_text().replace('// PRODUCTION_METHOD', method)
(out / 'Production.swift').write_text('import Foundation\n' + production)
(out / 'main.swift').write_text(main)
commands = [
    ['xcrun', 'swiftc', str(out / 'Production.swift'), str(out / 'main.swift'), '-o', str(out / 'replay')],
    [str(out / 'replay'), str(out / 'files')],
]
receipt = {'scope': 'Controlled native Swift bodies; real filesystem; in-memory UIKit, handle registry and binding DTOs. No OS clipboard or device.', 'commands': [], 'sha256': {}}
for f in [host, helpers, ROOT / 'modules/uc-engine/core-source.json', out / 'Production.swift', out / 'main.swift']:
    receipt['sha256'][str(f)] = hashlib.sha256((read_source(f).encode() if f in [host, helpers] else f.read_bytes())).hexdigest()
for i, command in enumerate(commands):
    r = subprocess.run(command, capture_output=True, text=True, timeout=90, cwd=ROOT)
    (out / f'command-{i}.log').write_text(r.stdout + r.stderr)
    receipt['commands'].append({'argv': command, 'exitCode': r.returncode})
    if r.returncode: break
receipt['artifactSha256'] = {
    str(f): hashlib.sha256(f.read_bytes()).hexdigest()
    for f in out.rglob('*') if f.is_file() and
    (f.name == 'replay' or f.suffix == '.class' or f.name in ['00000000', '原始文件.txt'])
}
receipt['fixture'] = {'sizeBytes': 793, 'displayName': '原始文件.txt',
    'sha256': hashlib.sha256(bytes(i % 239 for i in range(793))).hexdigest()}
receipt['sourceRef'] = a.source_ref or 'working-tree'
receipt['passed'] = len(receipt['commands']) == 2 and all(c['exitCode'] == 0 for c in receipt['commands'])
(out / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps({'passed': receipt['passed'], 'output': str(out)}))
raise SystemExit(0 if receipt['passed'] else 1)
