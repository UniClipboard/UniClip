#!/usr/bin/env python3
"""Replay pinned baseline or working native storage ownership without apps/devices."""
import argparse,datetime,hashlib,json,pathlib,re,shutil,subprocess,tempfile
root=pathlib.Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--baseline',action='store_true');p.add_argument('--module-storage',action='store_true');p.add_argument('--keyboard-source',type=pathlib.Path);p.add_argument('--output-root',type=pathlib.Path,default=root/'e2e/results/ios-suspension');a=p.parse_args()
base='fcf68bfe917fc7a12a3c0696ac90b5463ae0b724'
files=['modules/uc-engine/ios/'+n+'.swift' for n in ['NativeRuntimeDiagnostics','P2pRuntimeOwnership','ExtensionRuntimeLifecycle','NativeLifecycleHost','NativeAnalyticsHost','AnalyticsBindingCompatibility']]+['targets/_shared/'+n+'.swift' for n in ['AppSettings','Clipboard','ClipboardHistoryItem','LegacyContainerMigrator','SettingsStoreLegacyMigration','SettingsStore','ExtensionStableIdentifier','HistoryDatabase','HistoryLog','PayloadCache','ShareDiagnostics']]
if not a.baseline: files.append('modules/uc-engine/ios/NativeReleaseOwner.swift')
if a.module_storage:
 files=[f.replace('targets/_shared/','modules/app-group-store/ios/Shared/') if f.split('/')[-1] in ['SettingsStore.swift','PayloadCache.swift','ShareDiagnostics.swift'] else f for f in files]
if not a.baseline:files+=['modules/app-group-store/ios/Shared/SharedStorageAccess.swift']
output=a.output_root.resolve()/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
output.mkdir(parents=True)
receipt={'baseline':a.baseline,'moduleStorage':a.module_storage,'baselineCommit':base,'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'commands':[],'sourceHashes':{},'scope':'nonvisual native/storage E2E; no UIKit/device or real Engine'}
with tempfile.TemporaryDirectory(prefix='ios-suspension-') as tmp:
 t=pathlib.Path(tmp);sources=[]
 for f in files:
  data=subprocess.check_output(['git','show',base+':'+f],cwd=root) if a.baseline else (root/f).read_bytes()
  receipt['sourceHashes'][f]=hashlib.sha256(data).hexdigest()
  if f.endswith('/NativeAnalyticsHost.swift'):
   text=data.decode().replace('URLSession.shared.dataTask(with: request) { [self] _, response, _ in', 'URLSession.shared.dataTask(with: request) { [self] _, response, _ in\n      defer { AnalyticsAcceptanceCallback.queued.signal() }', 1)
   text+='\nextension ApplePostHogAnalyticsHost {\n  func flushDeliveryForAcceptance() { deliveryQueue.sync {} }\n}\n'
   data=text.encode();receipt['analyticsFixture']={'adaptations':['signal after callback schedules delivery work','delivery queue barrier'],'adaptedSha256':hashlib.sha256(data).hexdigest()}
  dest=t/f;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data);sources.append(str(dest))
 model='targets/keyboard/KeyboardModel.swift'
 if a.keyboard_source and a.baseline: raise ValueError('A baseline replay cannot override production source')
 model_data=a.keyboard_source.read_bytes() if a.keyboard_source else subprocess.check_output(['git','show',base+':'+model],cwd=root) if a.baseline else (root/model).read_bytes()
 receipt['keyboardSourceOverride']=str(a.keyboard_source.resolve()) if a.keyboard_source else None
 receipt['sourceHashes'][model]=hashlib.sha256(model_data).hexdigest()
 model_source=model_data.decode();start=model_source.index('final class KeyboardDiagnostics:');end=model_source.index('\n#if DEBUG',start)
 keyboard=model_source[start:end].rstrip()
 url_start=keyboard.index('        logURL = FileManager.default');url_end=keyboard.index('\n        record("diagnostics.session"',url_start)
 keyboard=keyboard[:url_start]+'        logURL = URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent("keyboard.jsonl")'+keyboard[url_end:]
 keyboard=keyboard.replace('    private init() {','    init() {',1)
 keyboard=keyboard.rsplit('}',1)[0]+'''    func flushForAcceptance() { queue.sync {} }
    func holdQueueForAcceptance(entered: DispatchSemaphore, release: DispatchSemaphore) {
        queue.async { entered.signal(); release.wait() }
    }
}
'''
 keyboard_path=t/'KeyboardDiagnostics.swift';keyboard_path.write_text('import Foundation\n'+keyboard);sources.append(str(keyboard_path))
 receipt['keyboardFixture']={'adaptations':['temporary container URL','constructor access','queue barriers'],'adaptedSha256':hashlib.sha256(keyboard_path.read_bytes()).hexdigest()}
 harness=root/'e2e/ios-suspension/main.swift';receipt['sourceHashes'][str(harness.relative_to(root))]=hashlib.sha256(harness.read_bytes()).hexdigest()
 schema=re.search(r'const CREATE_SCHEMA_V1 = `([\s\S]*?)`;', (root/'src/platform/database/sqliteDatabase.ts').read_text()).group(1).replace('${TABLE_HISTORY}','clipboard_history')
 (t/'schema.sql').write_text(schema)
 commands=[[shutil.which('swiftc'),'--version'],[shutil.which('swiftc'),'-swift-version','5','-D','SWIFT_PACKAGE','-parse-as-library','-module-cache-path',str(t/'module-cache')]+(['-D','BASELINE'] if a.baseline else [])+(['-D','MODULE_STORAGE'] if a.module_storage else [])+sources+[str(harness),'-o',str(t/'acceptance')],[str(t/'acceptance'),str(t),str(output),str(t/'schema.sql')]]
 status=0
 for i,cmd in enumerate(commands):
  try:r=subprocess.run(cmd,cwd=root,capture_output=True,timeout=60);status=r.returncode;stdout=r.stdout;stderr=r.stderr
  except subprocess.TimeoutExpired as e:status=124;stdout=e.stdout or b'';stderr=e.stderr or b''
  (output/f'{i}.stdout.txt').write_bytes(stdout);(output/f'{i}.stderr.txt').write_bytes(stderr)
  receipt['commands'].append({'argv':cmd,'exitCode':status})
  if status:break
 if (t/'diagnostics').exists():shutil.copytree(t/'diagnostics',output/'diagnostics')
 receipt['exitCode']=status;receipt['result']='PASS' if status==0 and len(receipt['commands'])==3 else 'FAIL'
 (output/'result.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(output);print(receipt['result']);raise SystemExit(status)
