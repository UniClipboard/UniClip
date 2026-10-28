// Actual React flow and stores; native rendering and Engine boundary are controlled.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const React = require('react');
const renderer = require('react-test-renderer');
const Module = require('node:module');
const root=path.resolve(__dirname,'../..');
global.IS_REACT_ACT_ENVIRONMENT=true;
const resolve=Module._resolveFilename, load=Module._load;
Module._resolveFilename=function(name,parent,...args){return resolve.call(this,name.startsWith('@/')?path.join(root,'src',name.slice(2)):name,parent,...args);};
for(const extension of ['.ts','.tsx']) require.extensions[extension]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const calls=[];
let classification='settled';
const fakeEngine={refreshOutboundProgress:async()=>{}};
const fakeSpace={resendEntry:async(entry,targets,confirm=false)=>{calls.push({entry,targets,confirm});return {kind:'completed',reconciled:targets.map(targetDeviceId=>({targetDeviceId,state:classification,current:null,newTransferRequested:confirm,duplicateFilesPossible:true})),accepted:0,duplicate:0,offline:0,errored:0,pending:0};}};
const strings=JSON.parse(fs.readFileSync(path.join(root,'src/i18n/locales/en/home.json')));
const t=(key,values={})=>{let value=key.split('.').reduce((v,k)=>v?.[k],strings)||key;for(const[k,v]of Object.entries(values)) value=value.replace(`{{${k}}}`,String(v));return value;};
Module._load=function(name,parent,...args){
 if(name==='react-native')return {View:'View',Text:'Text',StyleSheet:{create:x=>x}};
 if(name==='react-i18next')return {useTranslation:()=>({t})};
 if(name==='@/components/ui')return {AppButton:'Button',AppHost:'Host'};
 if(name==='@/hooks/useTheme')return {useTheme:()=>({theme:{colors:{}}})};
 if(name==='@/platform/engine')return {getUnifiedEngineService:()=>fakeEngine};
 if(name==='@/features/space')return {getUnifiedSpaceService:()=>fakeSpace,useUnifiedSpaceStore:fn=>fn({devices:[{deviceId:'target',displayName:'Synthetic device'}]})};
 return load.call(this,name,parent,...args);
};
(async()=>{
 const {useUnifiedEngineStore}=require('../../src/stores/unifiedEngineStore.ts');
 const {useOutboundResendStore,recordOutboundResend}=require('../../src/stores/outboundResendStore.ts');
 const {OutboundResultsSection}=require('../../src/components/ReceiveResultsSheet/OutboundResultsSection.tsx');
 const p={entryId:'entry',targetDeviceId:'target',attemptId:'attempt',revision:'1',freshness:'unconfirmed',freshnessAvailable:false,state:'unconfirmed',itemsRunning:0,itemsWaiting:0,itemsUnconfirmed:1,items:[{kind:'file',index:0,state:'unconfirmed',lastKnownPhase:null,round:null,completedBytes:null,totalBytes:null,failureReason:null,cancellationReason:null}]};
 useUnifiedEngineStore.setState({outbound:{progress:[p],available:true,error:false}});
 let tree;
 await renderer.act(async()=>{tree=renderer.create(React.createElement(OutboundResultsSection));});
 const button=title=>tree.root.findAllByType('Button').find(x=>x.props.title===title);
 assert.match(JSON.stringify(tree.toJSON()),/Unknown \/ Unknown bytes/);
 await renderer.act(async()=>{await button('Check existing transfer').props.onPress();});
 assert.equal(calls.length,1);assert.equal(calls[0].confirm,false);
 await renderer.act(async()=>{button('Request a new transfer').props.onPress();});
 assert.equal(calls.length,1);assert.match(JSON.stringify(tree.toJSON()),/duplicate files/);
 await renderer.act(async()=>{await button('Confirm new transfer').props.onPress();});
 assert.equal(calls.length,2);assert.equal(calls[1].confirm,true);
 for(const state of ['running','superseded','unreachable','busy']){
   await renderer.act(async()=>{recordOutboundResend('entry',[{targetDeviceId:'target',state,current:null,newTransferRequested:false,duplicateFilesPossible:false}]);});
   assert.equal(button('Request a new transfer'),undefined,state);
 }
 await renderer.act(async()=>{tree.unmount();});
 const receipt={passed:true,scope:'Actual React component and session stores; controlled Engine and native rendering. No native layout or hit testing.',checks:['unknown byte presentation','default false reaches Engine','request alone cannot send','duplicate warning before confirmation','only final confirmation sends true','running/superseded/unreachable/busy cannot request new transfer']};
 const output=process.argv[2] || path.join(root,'e2e/results/outbound-progress/ui-replay.json');
 fs.mkdirSync(path.dirname(output),{recursive:true});
 fs.writeFileSync(output,JSON.stringify(receipt,null,2)+'\n');
 console.log('Nonvisual React resend flow passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
