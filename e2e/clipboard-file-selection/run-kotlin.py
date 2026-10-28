#!/usr/bin/env python3
"""Run copied Android clipboard functions on JVM with in-memory Android boundaries."""
import argparse
import hashlib
import json
import os
import pathlib
import subprocess
ROOT = pathlib.Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--output', type=pathlib.Path, required=True)
p.add_argument('--source-ref', help='Read production source from this immutable Git revision')
a = p.parse_args()
out = a.output.resolve(); out.mkdir(parents=True, exist_ok=True)

def read_source(file):
    if a.source_ref:
        return subprocess.check_output(['git', 'show', f'{a.source_ref}:{file.relative_to(ROOT)}'], cwd=ROOT, text=True)
    return file.read_text()

module = ROOT / 'modules/uc-engine/android/src/main/java/expo/modules/ucengine/UcEngineModule.kt'
source = read_source(module)
functions = source[(source.index('private fun isFileListRepresentation(') if 'private fun isFileListRepresentation(' in source else source.index('private fun uriListFile(')):source.index('private fun analyticsContext(')]
functions += source[source.index('private const val CLIPBOARD_SHARE_MAX_ENTRIES'):source.index('/**\n * Process-wide owner')]
main = (ROOT / 'e2e/clipboard-file-selection/host.kt').read_text().replace('// PRODUCTION_FUNCTIONS', functions)
(out / 'Main.kt').write_text(main)
cache = pathlib.Path.home() / '.gradle/caches/modules-2/files-2.1'
def jar(group, name, version='*'):
    return next((cache / group / name).glob(f'{version}/*/*.jar'))
stdlib = jar('org.jetbrains.kotlin', 'kotlin-stdlib', '2.1.20')
annotations = jar('org.jetbrains', 'annotations', '13.0')
json_jar = jar('org.json', 'json')
compiler_jars = [jar('org.jetbrains.kotlin', 'kotlin-compiler-embeddable', '2.1.20'), stdlib,
    jar('org.jetbrains.kotlin', 'kotlin-script-runtime', '2.1.20'),
    jar('org.jetbrains.kotlin', 'kotlin-reflect'), jar('org.jetbrains.intellij.deps', 'trove4j'),
    jar('org.jetbrains.kotlinx', 'kotlinx-coroutines-core-jvm'), annotations]
java = os.environ.get('JAVA_HOME', '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home') + '/bin/java'
cp = os.pathsep.join(map(str, [stdlib, annotations, json_jar]))
commands = [
    [java, '-cp', os.pathsep.join(map(str, compiler_jars)), 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect', '-classpath', cp, str(out / 'Main.kt'), '-d', str(out / 'classes')],
    [java, '-cp', str(out / 'classes') + os.pathsep + cp, 'MainKt', str(out / 'files')],
]
receipt = {'scope': 'Copied Kotlin production functions; real JVM filesystem and JSON library; Android and DTO doubles. No Android device/FileProvider runtime.', 'commands': [], 'sha256': {}}
for f in [module, out / 'Main.kt', ROOT / 'modules/uc-engine/core-source.json', *compiler_jars, json_jar]:
    receipt['sha256'][str(f)] = hashlib.sha256((source.encode() if f == module else f.read_bytes())).hexdigest()
for i, command in enumerate(commands):
    r = subprocess.run(command, capture_output=True, text=True, cwd=ROOT, timeout=90)
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
