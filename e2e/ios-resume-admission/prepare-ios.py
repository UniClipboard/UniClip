#!/usr/bin/env python3
"""Select temporary test scheduling in the isolated workspace; restore all sources afterward."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--mode', choices=['baseline', 'fixed', 'restore'], required=True)
p.add_argument('--state', type=Path, required=True)
p.add_argument('--revision', default='386e49f70877b2c82114e2784a8742ee6fb9583a')
a = p.parse_args()
state = a.state.resolve()
state.mkdir(parents=True, exist_ok=True)
paths = ['index.ts', 'modules/uc-engine/ios/NativeLifecycleHost.swift', 'modules/uc-engine/ios/UcEngineModule.swift']
manifest_path = state / 'fixture-source-manifest.json'
if manifest_path.exists():
    previous = json.loads(manifest_path.read_text())
    for name in paths:
        digest = hashlib.sha256((root / name).read_bytes()).hexdigest()
        assert digest in [previous[name]['originalSha256'], previous[name]['instrumentedSha256']], f'Unrelated edit: {name}'
else:
    previous = {}
    for name in paths:
        data = (root / name).read_bytes()
        (state / (Path(name).name + '.original')).write_bytes(data)
        previous[name] = {'originalSha256': hashlib.sha256(data).hexdigest()}
if a.mode == 'restore':
    for name in paths:
        (root / name).write_bytes((state / (Path(name).name + '.original')).read_bytes())
    print('Restored exact pre-fixture source bytes')
    raise SystemExit(0)


def production(name):
    if a.mode == 'baseline':
        return subprocess.check_output(['git', 'show', f'{a.revision}:{name}'], cwd=root).decode()
    return (state / (Path(name).name + '.original')).read_text()


module = production(paths[2])
module = module.replace('flushObservability: { _ = try? flushProcessObservability(deadlineMs: 250) }', 'flushObservability: { try! Crash199TestScheduler.waitBeforeFlush(); _ = try? flushProcessObservability(deadlineMs: 250); Crash199TestScheduler.record("flush.complete") }', 1)
module = module.replace('    AsyncFunction("resume") {', '    AsyncFunction("resume") {\n      try Crash199TestScheduler.waitBeforeResume()', 1)
start = module.index('    AsyncFunction("resume") {')
at = module.index('\n    }.runOnQueue', start)
module = module[:at] + '\n      Crash199TestScheduler.record("bridge.resume.finished")' + module[at:]
module = module.replace('\n      UIApplication.shared.endBackgroundTask(active)', '\n      UIApplication.shared.endBackgroundTask(active)\n      Crash199TestScheduler.record("UIKit.endBackgroundTask", activityId: Int(active.rawValue))')
module = module.replace('\n    UIApplication.shared.endBackgroundTask(active)', '\n    UIApplication.shared.endBackgroundTask(active)\n    Crash199TestScheduler.record("UIKit.endBackgroundTask", activityId: Int(active.rawValue))')
module = module.replace('    OnAppEntersBackground {', '    OnAppEntersBackground {\n      Crash199TestScheduler.record("UIKit.background")', 1)
module = module.replace('    OnAppEntersForeground {', '    OnAppEntersForeground {\n      Crash199TestScheduler.record("UIKit.foreground")', 1)
module = module.replace('    try AppleNativeDiagnostics.observe(.engineResume) { try engine.resume() }', '    Crash199TestScheduler.record("engine.resume.begin")\n    try AppleNativeDiagnostics.observe(.engineResume) { try engine.resume() }\n    Crash199TestScheduler.record("engine.resume.complete")', 1)
needle = '          try engine.suspend()\n        }\n      }\n    } catch BindingError.Engine'
assert needle in module
module = module.replace(needle, '          try engine.suspend()\n        }\n      }\n      Crash199TestScheduler.record("engine.suspend.complete")\n    } catch BindingError.Engine', 1)
module = module.replace('    try host.acquireRuntimeOwnership(timeoutMs: timeoutMs)', '    let acquired = try host.acquireRuntimeOwnership(timeoutMs: timeoutMs)\n    if acquired { Crash199TestScheduler.record("ownership.acquired") }\n    return acquired', 1)
start = module.index('private final class MainApplicationRuntimeOwnership:')
module = module[:start] + module[start:].replace('    host.releaseRuntimeOwnership()', '    host.releaseRuntimeOwnership()\n    Crash199TestScheduler.record("ownership.released")', 1)
start = module.index('private final class AppleMobileEngineLifecycle:')
module = module[:start] + module[start:].replace('  func lifecycleState() throws -> NativeEngineLifecycleState {', '  func lifecycleState() throws -> NativeEngineLifecycleState {\n    Crash199TestScheduler.record("engine.state.read")', 1)
module = module.replace('Crash199TestScheduler.record("engine.state.read")\n    switch try engine.lifecycleState()', 'Crash199TestScheduler.record("engine.state.read")\n    return switch try engine.lifecycleState()', 1)
module += '\n' + (root / 'e2e/ios-resume-admission/scheduler.swift').read_text()
host = production(paths[1])
host = host.replace('    report([], false)', '    Crash199TestScheduler.record("background.closure.report")\n    report([], false)', 1)
if a.mode == 'fixed':
    host = host.replace('    admissionLock.withLock { foregroundAdmission = allowed }', '    admissionLock.withLock { foregroundAdmission = allowed }\n    Crash199TestScheduler.record(allowed ? "admission.open" : "admission.closed")', 1)
    host = host.replace('      guard canResume else { return }', '      guard canResume else { Crash199TestScheduler.record("admission.denied"); return }')
start = host.index('private final class NativeLifecycleTransition:')
end = host.index('\n  func enterForeground()', start)
at = host.rfind('\n  }', start, end)
host = host[:at] + '\n    Crash199TestScheduler.record("background.transition.returned")' + host[at:]
(root / paths[2]).write_text(module)
(root / paths[1]).write_text(host)
(root / paths[0]).write_text("import './e2e/ios-resume-admission/native-entry.cjs';\n")
for name in paths:
    previous[name]['instrumentedSha256'] = hashlib.sha256((root / name).read_bytes()).hexdigest()
manifest_path.write_text(json.dumps(previous, indent=2) + '\n')
(state / f'{a.mode}-manifest.json').write_text(json.dumps(previous, indent=2) + '\n')
for name in paths:
    (state / f'{a.mode}-{Path(name).name}').write_bytes((root / name).read_bytes())
print('Test source mode:', a.mode)
