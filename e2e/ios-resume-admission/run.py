#!/usr/bin/env python3
"""Compile actual native lifecycle sources and replay controlled host schedules."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--output', required=True, type=Path)
p.add_argument('--revision', help='Read production sources from this Git revision without modifying the worktree')
a = p.parse_args()
out = a.output.resolve()
out.mkdir(parents=True, exist_ok=True)
sources = [root / 'modules/uc-engine/ios' / name for name in
           ['NativeLifecycleHost.swift', 'P2pRuntimeOwnership.swift', 'NativeRuntimeDiagnostics.swift']]
original_sources = list(sources)
if a.revision:
    staged = out / 'source'
    staged.mkdir(exist_ok=True)
    for original in original_sources:
        data = subprocess.check_output(['git', 'show', f'{a.revision}:{original.relative_to(root)}'], cwd=root)
        (staged / original.name).write_bytes(data)
    sources = [staged / original.name for original in original_sources]
sources.append(root / 'e2e/ios-resume-admission/main.swift')
commands = [['xcrun', 'swiftc', *map(str, sources), '-o', str(out / 'host')], [str(out / 'host'), str(out)]]
receipt = {'commands': [], 'revision': a.revision, 'sourceHashes': {str(f): hashlib.sha256(f.read_bytes()).hexdigest() for f in sources},
           'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
           'scope': 'Controlled macOS host replay. Application iOS E2E NOT RUN.'}
for i, command in enumerate(commands):
    with (out / f'command-{i}.log').open('w') as log:
        result = subprocess.run(command, cwd=root, stdout=log, stderr=subprocess.STDOUT, timeout=120)
    receipt['commands'].append({'argv': command, 'exitCode': result.returncode})
    if result.returncode:
        break
receipt['passed'] = len(receipt['commands']) == 2 and receipt['commands'][-1]['exitCode'] == 0
(out / 'commands.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt, indent=2))
raise SystemExit(0 if receipt['passed'] else 1)
