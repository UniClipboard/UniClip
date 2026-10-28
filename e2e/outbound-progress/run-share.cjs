// Execute the actual Share hook for repeated sends in one live session.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript'),React=require('react'),renderer=require('react-test-renderer'),Module=require('node:module');
const root=path.resolve(__dirname,'../..'),resolve=Module._resolveFilename,load=Module._load;
global.IS_REACT_ACT_ENVIRONMENT=true;
Module._resolveFilename=function(name,parent,...args){return resolve.call(this,name.startsWith('@/')?path.join(root,'src',name.slice(2)):name,parent,...args);};
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const state={devices:[{deviceId:'target',displayName:'Synthetic device',isLocal:false}],hasResolvedDeviceList:true,status:'ready'};
const spaceStore=fn=>fn(state);spaceStore.getState=()=>state;
const lan={servers:[],refresh:async()=>{},isRefreshing:false};
let sends=0;const checks=[];
const sync={sendImportedAsset:async()=>{sends++;return {entryId:'entry',transport:'p2p',success:false,state:'pending'};}};
const space={refreshDevices:async()=>{},refresh:async()=>{},resendEntry:async(entry,targets,confirmed=false)=>{checks.push({entry,targets,confirmed});return {kind:'completed',reconciled:[{targetDeviceId:'target',state:'running',current:null,newTransferRequested:false,duplicateFilesPossible:false}]};}};
Module._load=function(name,parent,...args){
 if(name==='react-native')return {Alert:{alert:()=>{}}};
 if(name==='expo-haptics')return {notificationAsync:async()=>{},NotificationFeedbackType:{Success:'success'}};
 if(name==='expo-file-system')return {File:class{}};
 if(name==='react-i18next')return {useTranslation:()=>({t:key=>key})};
 if(name==='app-group-store')return {recordShareDiagnosticStage:async()=>{}};
 if(name==='@/platform/engine')return {getUnifiedEngineService:()=>({refreshOutboundProgress:async()=>{}})};
 if(name==='@/features/space')return {getUnifiedSpaceService:()=>space,useUnifiedSpaceStore:spaceStore};
 if(name==='@/features/settings')return {useSettingsStore:fn=>fn({config:{syncChannel:'p2p'}})};
 if(name==='@/features/sync')return {getUnifiedSyncRuntime:()=>sync};
 if(name==='@/features/transfer')return {p2pDeliveryStateFromResend:()=> 'pending',getOutboundShareHandoffManager:()=>({completeJob:async()=>{}}),createPendingShareStore:()=>({})};
 if(name==='@/app/runtime/composition')return {getAppRuntime:()=>({ensureStarted:async()=>{}})};
 if(name==='@/support/observability')return {createLogger:()=>({warn:()=>{},error:()=>{}})};
 if(name==='@/utils/uploadFile')return {};
 if(name==='../useLanMySpaceSheet')return {useLanMySpaceSheet:()=>lan};
 return load.call(this,name,parent,...args);
};
(async()=>{
 const {useShareSendController}=require('../../src/components/ShareSendSheet/useShareSendController.ts');
 const jobs=[{id:'job',kind:'file',fileUri:'controlled://file',displayName:'Synthetic file',historyProfileHash:'synthetic-profile',createdAtMs:Date.now()}];
 let current,tree;const close=()=>{};
 function Host(){current=useShareSendController(close,true,jobs);return React.createElement('View');}
 await renderer.act(async()=>{tree=renderer.create(React.createElement(Host));});
 assert.equal(current.jobViews.length,1);assert.equal(current.selectedTargetIds.size,1);
 await renderer.act(async()=>{await current.sendAll();});assert.equal(sends,1);
 await renderer.act(async()=>{await current.sendAll();});
 assert.equal(sends,1,'second press started another transfer');
 assert.deepEqual(checks,[{entry:'entry',targets:['target'],confirmed:false}]);
 assert.equal(current.jobViews[0].errorMessage,'send.unconfirmed');
 await renderer.act(async()=>{tree.unmount();});
 const output=process.argv[2] || path.join(root,'e2e/results/outbound-progress/share-replay.json');
 fs.mkdirSync(path.dirname(output),{recursive:true});
 fs.writeFileSync(output,JSON.stringify({passed:true,scope:'Actual Share hook and session state. Controlled sync/native boundaries; no App, queue storage or native layout execution.',checks:['initial file intent dispatched once','second session press only checks same entry','confirmation defaults false','unknown result is presented as unconfirmed']},null,2)+'\n');
 console.log('Share same-session resend flow passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
