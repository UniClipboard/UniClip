#!/usr/bin/env python3
"""Replay the Android final-owner methods with controlled Engine receipts and real file locks."""
import argparse,hashlib,json,pathlib,subprocess,zipfile
root=pathlib.Path(__file__).resolve().parents[2];p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args();out=a.output.resolve();(out/'src').mkdir(parents=True,exist_ok=True)
module=root/'modules/uc-engine/android/src/main/java/expo/modules/ucengine/UcEngineModule.kt';source=module.read_text()
start=source.index('  internal fun shutdown(context: Context, deadlineMs: Long)');end=source.index('\n}\n\nclass UcEngineModule',start)
methods=source[start:end].replace('Context','ReplayContext')
preamble='''import uniffi.uc_engine_uniffi.*
import java.io.File
import java.nio.channels.FileChannel
import java.nio.file.StandardOpenOption
class ReplayContext(val file:File)
class Diagnostics { fun flush() {} }
object AndroidNativeDiagnostics { fun get(context:ReplayContext)=Diagnostics() }
class ReplayEngine(val outcomes:MutableList<BindingResourceRelease>) {
 var calls=0; var closes=0
 fun shutdownWithOutcome(deadline:ULong):BindingResourceRelease { calls++; return outcomes.removeAt(0) }
 fun close() { closes++ }
}
class ReplayFiles(file:File) {
 val channel=FileChannel.open(file.toPath(),StandardOpenOption.CREATE,StandardOpenOption.WRITE)
 val held=channel.lock()
 var closes=0
 fun removeAll() { closes++; held.release();channel.close() }
}
object OwnerReplay {
 private val transitions=java.util.concurrent.locks.ReentrantLock()
 private val lock=Any()
 var engine:ReplayEngine?=null
 var files:ReplayFiles?=null
 var startupLifecycle:Any?=null
 var pendingSuspension:ReplayEngine?=null
 var finalRelease:BindingResourceRelease?=null
 fun engine()=engine
 fun reset(active:ReplayEngine?,registry:ReplayFiles,startup:Any?=null) {engine=active;files=registry;startupLifecycle=startup;finalRelease=null}
'''
(out/'src/Owner.kt').write_text(preamble+methods+'\n}\n')
(out/'src/Main.kt').write_text('''import uniffi.uc_engine_uniffi.*
import java.io.File
import java.nio.channels.FileChannel
import java.nio.file.StandardOpenOption
fun main(args:Array<String>) {
 if(args.firstOrNull()=="probe") {
   FileChannel.open(File(args[1]).toPath(),StandardOpenOption.WRITE).use { channel ->
     val held=channel.tryLock(); if(held==null) kotlin.system.exitProcess(10) else held.release()
   }; return
 }
 val root=File(args[0]);root.mkdirs()
 fun probe(file:File,held:Boolean) {
   val java=File(System.getProperty("java.home"),"bin/java").path
   val code=ProcessBuilder(java,"-cp",System.getProperty("java.class.path"),"MainKt","probe",file.path).inheritIO().start().waitFor()
   check(code==if(held)10 else 0) {"independent file probe mismatch: $code"}
 }
 val failure=BindingException.Engine(1002u,BindingErrorCategory.DEADLINE_EXCEEDED,true)
 var cases=0
 // Pending retains the actual replay owner and file. Released(error) closes once and preserves error.
 run {
  val file=File(root,"pending.lock");val files=ReplayFiles(file)
  val engine=ReplayEngine(mutableListOf(BindingResourceRelease.Pending,BindingResourceRelease.Released(failure)))
  OwnerReplay.reset(engine,files)
  check(runCatching{OwnerReplay.shutdown(ReplayContext(file),1)}.isFailure)
  check(OwnerReplay.engine===engine && files.closes==0);probe(file,true)
  check(runCatching{OwnerReplay.shutdownUntilComplete(ReplayContext(file))}.exceptionOrNull()===failure)
  check(OwnerReplay.engine==null && engine.closes==1 && files.closes==1);probe(file,false)
  check(runCatching{OwnerReplay.shutdown(ReplayContext(file),1)}.exceptionOrNull()===failure)
  check(engine.calls==2 && files.closes==1);cases++
 }
 // Failed stops automatic waits, keeps the strong owner and permits only explicit retry.
 run {
  val file=File(root,"failed.lock");val files=ReplayFiles(file)
  val engine=ReplayEngine(mutableListOf(BindingResourceRelease.Failed(failure),BindingResourceRelease.Released(null)))
  OwnerReplay.reset(engine,files)
  check(runCatching{OwnerReplay.shutdownUntilComplete(ReplayContext(file))}.exceptionOrNull()===failure)
  check(engine.calls==1 && OwnerReplay.engine===engine && files.closes==0);probe(file,true)
  OwnerReplay.shutdownUntilComplete(ReplayContext(file));check(engine.calls==2 && engine.closes==1);probe(file,false);cases++
 }
 // Repeated Pending waits settle the same instance.
 run {
  val file=File(root,"repeat.lock");val files=ReplayFiles(file)
  val engine=ReplayEngine(mutableListOf(BindingResourceRelease.Pending,BindingResourceRelease.Pending,BindingResourceRelease.Released(null)))
  OwnerReplay.reset(engine,files);OwnerReplay.shutdownUntilComplete(ReplayContext(file))
  check(engine.calls==3 && engine.closes==1 && files.closes==1);probe(file,false);cases++
 }
 // No-object failed startup cannot manufacture a release receipt.
 run {
  val file=File(root,"startup.lock");val files=ReplayFiles(file)
  OwnerReplay.reset(null,files,Any())
  check(runCatching{OwnerReplay.shutdownUntilComplete(ReplayContext(file))}.isFailure)
  check(files.closes==0 && OwnerReplay.startupLifecycle!=null);probe(file,true)
  files.removeAll();cases++
 }
 println("ANDROID_OWNER_PASS cases=$cases independent_file_probes=true controlled_receipts=true")
}
''')
aar=root/'modules/uc-engine/android/release-maven/app/uniclipboard/uniclipboard-engine/1.1.0-rc.23/uniclipboard-engine-1.1.0-rc.23.aar'
with zipfile.ZipFile(aar) as z:(out/'engine-classes.jar').write_bytes(z.read('classes.jar'))
(out/'settings.gradle').write_text("pluginManagement { repositories { gradlePluginPortal(); mavenCentral() } }\nrootProject.name='android-owner-replay'\n")
(out/'build.gradle').write_text("plugins { id 'org.jetbrains.kotlin.jvm' version '2.1.20'; id 'application' }\nrepositories { mavenCentral() }\ndependencies { implementation files('engine-classes.jar') }\nsourceSets.main.kotlin.srcDirs=['src']\napplication { mainClass='MainKt' }\ntasks.named('run') { args '"+str(out/'files')+"' }\n")
with (out/'run.log').open('w') as log:r=subprocess.run([str(root/'android/gradlew'),'--no-daemon','-p',str(out),'run','--console=plain'],stdout=log,stderr=subprocess.STDOUT,cwd=root,timeout=180)
receipt={'passed':r.returncode==0 and 'ANDROID_OWNER_PASS' in (out/'run.log').read_text(),'exitCode':r.returncode,'scope':'Actual final-owner method bodies with Context type renamed, controlled Engine receipts, generated outcome types and independent JVM file-lock probes. No Android framework/device/service runtime. Suspension scheduler is compile-only.','sourceSha256':hashlib.sha256(module.read_bytes()).hexdigest()}
(out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
if not receipt['passed']:raise SystemExit('Owner replay failed; inspect run.log')
print('Controlled Android owner and independent file-lock replay passed')
