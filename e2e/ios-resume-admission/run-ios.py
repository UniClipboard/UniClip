#!/usr/bin/env python3
"""Drive an instrumented test build through real UIKit background/foreground and Expo resume."""
import argparse
import json
import hashlib
import fcntl
import plistlib
from pathlib import Path
import subprocess
import time

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--device', required=True, help='Task-owned simulator only')
p.add_argument('--app', required=True, type=Path)
p.add_argument('--output', required=True, type=Path)
p.add_argument('--case', choices=['A', 'B', 'C'], required=True)
a = p.parse_args()
out = a.output.resolve()
out.mkdir(parents=True, exist_ok=True)
commands = []
app_id = 'app.uniclipboard.UniClipboard.test'


def command(*args, allow_failure=False):
    argv = ['xcrun', 'simctl', *args]
    result = subprocess.run(argv, capture_output=True, text=True, timeout=60)
    commands.append({'argv': argv, 'exitCode': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr})
    (out / 'commands.json').write_text(json.dumps(commands, indent=2) + '\n')
    if result.returncode and not allow_failure:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


cache = None
runtime_lock = None


def runtime_probe():
    with runtime_lock.open("r+b") as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            available = False
        else:
            available = True
            fcntl.flock(stream, fcntl.LOCK_UN)
    receipt.setdefault("runtimeFlockProbes", []).append({"available": available, "monotonicNs": str(time.monotonic_ns())})
    return available


def native_events():
    file = cache / 'crash199-native.jsonl'
    if not file.exists():
        return []
    result = []
    for line in file.read_text().splitlines():
        try:
            result.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return result


def wait_for(condition, label, timeout=30):
    start = time.monotonic()
    while time.monotonic() - start < timeout:
        result = condition()
        if result:
            return result
        time.sleep(0.05)
    raise RuntimeError('Timed out: ' + label)


def event_count(name):
    return sum(row['event'] == name for row in native_events())


receipt = {'case': a.case, 'expected': 'deny', 'scope': 'Instrumented test-only scheduling; actual Expo bridge, operation queue, UIKit callbacks, Engine and UIKit endBackgroundTask calls', 'passed': False}
workspace = Path(__file__).resolve().parents[2]
receipt['head'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=workspace, text=True).strip()
receipt['enginePin'] = json.loads((workspace / 'modules/uc-engine/core-source.json').read_text())
receipt['sourceHashes'] = {name: hashlib.sha256((workspace / name).read_bytes()).hexdigest() for name in
    ['index.ts', 'modules/uc-engine/ios/NativeLifecycleHost.swift', 'modules/uc-engine/ios/UcEngineModule.swift',
     'e2e/ios-resume-admission/native-entry.cjs', 'e2e/ios-resume-admission/scheduler.swift', 'e2e/ios-resume-admission/run-ios.py']}
info = plistlib.loads((a.app / 'Info.plist').read_bytes())
receipt['app'] = {key: info.get(key) for key in ['CFBundleIdentifier', 'CFBundleVersion', 'CFBundleShortVersionString']}
receipt['binaryHashes'] = {}
for binary in [a.app / info['CFBundleExecutable'], a.app / (info['CFBundleExecutable'] + '.debug.dylib')]:
    if binary.exists():
        with binary.open('rb') as stream:
            receipt['binaryHashes'][binary.name] = hashlib.file_digest(stream, 'sha256').hexdigest()
        receipt.setdefault('binaryUUIDs', {})[binary.name] = subprocess.check_output(['xcrun', 'dwarfdump', '--uuid', str(binary)], text=True).strip()

try:
    command('terminate', a.device, app_id, allow_failure=True)
    command('install', a.device, str(a.app.resolve()))
    container = Path(command('get_app_container', a.device, app_id, 'data'))
    groups = dict(line.split('\t', 1) for line in command('get_app_container', a.device, app_id, 'groups').splitlines() if '\t' in line)
    group = Path(groups['group.app.uniclipboard.UniClipboard.test'])
    runtime_lock = group / 'p2p/.runtime.lock'
    cache = container / 'Library/Caches'
    cache.mkdir(parents=True, exist_ok=True)
    for name in ['crash199-result.json', 'crash199-native.jsonl', 'crash199-hold-resume', 'crash199-issue-request', 'crash199-hold-flush']:
        (cache / name).unlink(missing_ok=True)
    command('launch', a.device, app_id, '-RCT_jsLocation', '127.0.0.1:8099')
    result_file = cache / 'crash199-result.json'

    def read_result():
        try:
            return json.loads(result_file.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def ready():
        state = read_result()
        if state.get('error'):
            raise RuntimeError(state['error'])
        return state.get('stage') == 'ready'

    wait_for(ready, 'real Engine startup')
    if a.case in ['B', 'C']:
        (cache / 'crash199-hold-resume').write_text('test scheduler gate\n')
        (cache / 'crash199-issue-request').write_text('test request\n')
        wait_for(lambda: event_count('bridge.resume.entered') == 1, 'resume entered native operation queue')
    if a.case == 'C':
        (cache / 'crash199-hold-flush').write_text('test flush gate\n')
    command('launch', a.device, 'com.apple.mobilesafari')
    if a.case == 'C':
        wait_for(lambda: event_count('engine.suspend.complete') >= 1 and event_count('flush.entered') >= 1, 'suspend then blocked flush')
        command('launch', a.device, app_id)
        wait_for(lambda: event_count('UIKit.foreground') >= 1, 'foreground during old flush')
        (cache / 'crash199-hold-resume').unlink()
        wait_for(lambda: event_count('bridge.resume.released') >= 1, 'native resume released in foreground')
        time.sleep(0.4)
        resumed_during_flush = event_count('engine.resume.begin') > 0
        (cache / 'crash199-hold-flush').unlink()
        wait_for(lambda: read_result().get('stage') == 'background-complete', 'bridge return after flush release')
        wait_for(lambda: event_count('engine.resume.complete') >= 1 and event_count('UIKit.endBackgroundTask') >= 1, 'recovery and actual activity end')
        rows = native_events()
        resume_at = next(i for i, row in enumerate(rows) if row['event'] == 'engine.resume.begin')
        late_closure = any(row['event'] == 'background.closure.report' for row in rows[resume_at + 1:])
        receipt.update({'resumedDuringOldFlush': resumed_during_flush, 'lateClosureReport': late_closure, 'foregroundRecovered': True,
                        'passed': not resumed_during_flush and not late_closure, 'events': rows, 'js': read_result()})
        (out / 'result.json').write_text(json.dumps(receipt, indent=2) + '\n')
        print(json.dumps({'case': a.case, 'passed': receipt['passed']}))
        raise SystemExit(0 if receipt['passed'] else 1)
    wait_for(lambda: event_count('background.transition.returned') >= 1, 'real native suspension/completion return')
    runtime_before = runtime_probe()
    if a.case == 'A':
        (cache / 'crash199-issue-request').write_text('release old JS request after native suspend\n')
    else:
        (cache / 'crash199-hold-resume').unlink()
    wait_for(lambda: read_result().get('stage') == 'background-complete', 'bridge return and host suspension acknowledgement')
    wait_for(lambda: event_count('UIKit.endBackgroundTask') >= 1, 'actual UIKit endBackgroundTask')
    runtime_after = runtime_probe()
    before_foreground = native_events()
    closed_at = next(i for i, row in enumerate(before_foreground) if row['event'] == 'background.transition.returned')
    denied = not any(row['event'] in ['engine.resume.begin', 'ownership.acquired', 'engine.state.read'] for row in before_foreground[closed_at + 1:])
    samples = [row.get('files') for row in before_foreground if row['event'] in ['background.transition.returned', 'bridge.resume.finished']]
    files_stayed_closed = len(samples) == 2 and all(sample is not None and sample['database'] == 0 for sample in samples)
    suspended = any(row['event'] == 'engine.suspend.complete' for row in before_foreground)
    released = any(row['event'] == 'ownership.released' for row in before_foreground)
    command('launch', a.device, app_id)
    wait_for(lambda: event_count('UIKit.foreground') >= 1, 'real foreground callback')
    if denied:
        wait_for(lambda: event_count('engine.resume.complete') >= 1, 'legitimate foreground recovery')
    cycles = []
    if denied:
        for number in range(3):
            backgrounds = event_count('background.transition.returned')
            resumes = event_count('engine.resume.complete')
            ends = event_count('UIKit.endBackgroundTask')
            command('launch', a.device, 'com.apple.mobilesafari')
            wait_for(lambda: event_count('background.transition.returned') > backgrounds, 'repeat suspend')
            command('launch', a.device, app_id)
            wait_for(lambda: event_count('engine.resume.complete') > resumes, 'repeat foreground resume')
            wait_for(lambda: event_count('UIKit.endBackgroundTask') > ends, 'retired prior activity')
            cycles.append({'cycle': number, 'recovered': True, 'activityEnded': True})
    receipt.update({'deniedInBackground': denied, 'expectedBehaviorObserved': denied,
                    'foregroundRecovered': denied and event_count('engine.resume.complete') >= 1,
                    'actualEngineSuspended': suspended, 'runtimeOwnershipReleased': released, 'engineDatabasesClosedAtBothSamples': files_stayed_closed, 'runtimeFlockAvailableBeforeAndAfterRequest': runtime_before and runtime_after,
                    'rapidCycles': cycles, 'events': native_events(), 'js': read_result()})
    receipt['passed'] = receipt['expectedBehaviorObserved'] and receipt['foregroundRecovered'] and suspended and released and files_stayed_closed and runtime_before and runtime_after
except Exception as error:
    receipt['error'] = str(error)
finally:
    if cache:
        receipt['events'] = native_events()
        result_file = cache / 'crash199-result.json'
        if result_file.exists():
            (out / 'js-result.json').write_bytes(result_file.read_bytes())
    (out / 'result.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps({'case': a.case, 'passed': receipt['passed'], 'error': receipt.get('error')}))
raise SystemExit(0 if receipt['passed'] else 1)
