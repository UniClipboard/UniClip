#!/usr/bin/env python3
"""Type-check the replayed production functions against real native SDK APIs."""
import argparse
import hashlib
import json
import pathlib
import subprocess
import zipfile
ROOT = pathlib.Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--swift-replay', type=pathlib.Path, required=True)
p.add_argument('--kotlin-replay', type=pathlib.Path, required=True)
p.add_argument('--android-sdk', type=pathlib.Path, required=True)
p.add_argument('--output', type=pathlib.Path, required=True)
a = p.parse_args()
out = a.output.resolve(); out.mkdir(parents=True, exist_ok=True)
swift = (a.swift_replay / 'main.swift').read_text()
dtos = swift[swift.index('enum BindingClipboardRepresentation'):swift.index('struct UIImage')]
wrappers = swift[swift.index('func onMain'):swift.index('\nlet root =')]
(out / 'SwiftAPI.swift').write_text('import Foundation\nimport UIKit\nimport UniformTypeIdentifiers\n' + dtos + 'enum HostBindingError: Error { case Unavailable }\n' + wrappers)
android = a.android_sdk / 'platforms/android-36/android.jar'
core = next((pathlib.Path.home() / '.gradle/caches/modules-2/files-2.1/androidx.core/core/1.18.0').glob('*/*.aar'))
with zipfile.ZipFile(core) as archive:
    (out / 'androidx-core.jar').write_bytes(archive.read('classes.jar'))
kotlin = (a.kotlin_replay / 'Main.kt').read_text()
dtos = kotlin[kotlin.index('sealed class HostBindingException'):kotlin.index('private fun isFileListRepresentation')]
functions = kotlin[kotlin.index('private fun isFileListRepresentation'):kotlin.index('fun main(args:')]
imports = '''import android.content.Context
import android.content.ClipData
import android.net.Uri
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.util.UUID
'''
(out / 'KotlinAPI.kt').write_text(imports + dtos + functions)
compile_command = json.loads((a.kotlin_replay / 'receipt.json').read_text())['commands'][0]['argv']
cp_index = compile_command.index('-classpath') + 1
compile_command[cp_index] += ':' + str(android) + ':' + str(out / 'androidx-core.jar')
compile_command[-3:] = [str(out / 'KotlinAPI.kt'), '-d', str(out / 'kotlin-classes')]
commands = [
    ['xcrun', '--sdk', 'iphonesimulator', 'swiftc', '-typecheck', '-target', 'arm64-apple-ios16.4-simulator', str(ROOT / 'modules/uc-engine/ios/NativeSystemHost.swift'), str(out / 'SwiftAPI.swift')],
    compile_command,
]
receipt = {'scope': 'Real iOS UIKit and Android SDK/AndroidX API type checks. Binding records and handle registry are doubles. No full app build, native Engine artifact or device execution.', 'commands': [], 'sha256': {}}
for f in [android, core, out / 'SwiftAPI.swift', out / 'KotlinAPI.kt']:
    receipt['sha256'][str(f)] = hashlib.sha256(f.read_bytes()).hexdigest()
for i, command in enumerate(commands):
    r = subprocess.run(command, text=True, capture_output=True, timeout=90)
    (out / f'command-{i}.log').write_text(r.stdout + r.stderr)
    receipt['commands'].append({'argv': command, 'exitCode': r.returncode})
receipt['passed'] = all(c['exitCode'] == 0 for c in receipt['commands'])
(out / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps({'passed': receipt['passed'], 'output': str(out)}))
raise SystemExit(0 if receipt['passed'] else 1)
