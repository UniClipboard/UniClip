#!/usr/bin/env python3
"""Replay actual Kotlin mapper bodies against the exact generated AAR records on a JVM."""
import argparse, hashlib, json, pathlib, subprocess, zipfile
root=pathlib.Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args()
out=a.output.resolve();(out/'src').mkdir(parents=True,exist_ok=True)
aar=root/'modules/uc-engine/android/release-maven/app/uniclipboard/uniclipboard-engine/1.1.0-rc.23/uniclipboard-engine-1.1.0-rc.23.aar'
with zipfile.ZipFile(aar) as z: (out/'engine-classes.jar').write_bytes(z.read('classes.jar'))
module=root/'modules/uc-engine/android/src/main/java/expo/modules/ucengine/UcEngineModule.kt'
source=module.read_text();start=source.index('  private fun resendOutcomeMap(');end=source.index('  private fun receiveProgressMap(',start)
error_start=source.index('  private inline fun engineResult(');error_end=source.index('  private fun eventMap(',error_start)
(out/'src/BridgeReplay.kt').write_text('import uniffi.uc_engine_uniffi.*\nobject BridgeReplay {\n'+source[start:end].replace('private fun','fun')+source[error_start:error_end].replace('private inline fun','inline fun').replace('private fun','fun')+'\n}\n')
(out/'src/Main.kt').write_text('''import uniffi.uc_engine_uniffi.*
fun main() {
 val envelope=BridgeReplay.engineResult { throw BindingException.Engine(1415u,BindingErrorCategory.UNAUTHORIZED,false) }
 check(envelope["ok"]==false)
 val fields=envelope["failure"] as Map<*,*>
 check(fields["code"]==1415L && fields["category"]=="UNAUTHORIZED" && fields["retryable"]==false)
 var count=0
 for (state in listOf("no_items","waiting","in_progress","unconfirmed","partially_unconfirmed","completed","failed","partially_failed","cancelled","partially_cancelled")) {
   val items=listOf("waiting","transferring","processing","retrying","completed","failed","cancelled","unconfirmed").mapIndexed { index, value ->
     OutboundProgressItem("file",index.toUShort(),value,null,null,if(index==0) null else ULong.MAX_VALUE,null,null,null)
   }
   val progress=OutboundProgress("entry","target",null,ULong.MAX_VALUE,"unconfirmed",false,state,8u,1u,3u,1u,1u,1u,1u,items)
   val mapped=BridgeReplay.outboundProgressMap(progress)
   check(mapped["revision"]=="18446744073709551615")
   check(mapped["attemptId"]==null)
   val rows=mapped["items"] as List<*>
   check((rows[0] as Map<*,*>)["completedBytes"]==null)
   check((rows[1] as Map<*,*>)["completedBytes"]=="18446744073709551615")
   for (classification in listOf("running","settled","superseded","not_retained","unsupported","unreachable","busy")) {
     val targets=listOf(ResendTargetProgress("target",classification,progress,false,true),ResendTargetProgress("second",classification,null,false,false))
     val outcome=BridgeReplay.resendOutcomeMap(ResendEntryOutcome.Completed(targets,0uL,0uL,0uL,0uL,0uL))
     val result=outcome["reconciled"] as List<*>
     check(result.size==2)
     check((result[0] as Map<*,*>)["state"]==classification)
     check((result[1] as Map<*,*>)["current"]==null)
     check(((result[0] as Map<*,*>)["current"] as Map<*,*>)["state"]==state)
   }
   count++
 }
 println("KOTLIN_BRIDGE_PASS batches=$count item_states=8 reconciliations=7 exact_u64_and_null=true")
}
''')
(out/'settings.gradle').write_text("pluginManagement { repositories { gradlePluginPortal(); mavenCentral() } }\nrootProject.name='outbound-bridge-replay'\n")
(out/'build.gradle').write_text("""plugins { id 'org.jetbrains.kotlin.jvm' version '2.1.20'; id 'application' }
repositories { mavenCentral() }
dependencies { implementation files('engine-classes.jar') }
sourceSets.main.kotlin.srcDirs = ['src']
application { mainClass = 'MainKt' }
""")
command=[str(root/'android/gradlew'),'--no-daemon','-p',str(out),'run','--console=plain']
with (out/'run.log').open('w') as log: result=subprocess.run(command,cwd=root,stdout=log,stderr=subprocess.STDOUT,timeout=180)
receipt={'scope':'Actual copied Kotlin mapper methods, generated AAR DTOs and JVM. No Android App or device runtime.', 'exitCode':result.returncode,'hashes':{}}
for f in [module,aar,out/'src/BridgeReplay.kt',out/'engine-classes.jar']:
 with f.open('rb') as stream: receipt['hashes'][str(f)]=hashlib.file_digest(stream,'sha256').hexdigest()
receipt['passed']=result.returncode==0 and 'KOTLIN_BRIDGE_PASS' in (out/'run.log').read_text()
(out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
if not receipt['passed']: raise SystemExit('Kotlin bridge replay failed; inspect run.log')
print('Kotlin bridge replay passed')
