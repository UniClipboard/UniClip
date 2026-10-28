// Execute the actual exported TS/native-module boundary with controlled native envelopes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript'),Module=require('node:module');
const root=path.resolve(__dirname,'../..'),load=Module._load;
let failed=false;const calls=[];
const progress={entryId:'entry',targetDeviceId:'target',attemptId:null,revision:'18446744073709551615',freshness:'unconfirmed',freshnessAvailable:false,state:'partially_unconfirmed',items:[{completedBytes:null,totalBytes:null}]};
const envelope=value=>failed?{ok:false,failure:{code:1415,category:'unauthorized',retryable:false}}:{ok:true,value};
const native={
 queryOutboundProgress:async(...args)=>{calls.push(['query',...args]);return envelope({progress});},
 listOutboundProgress:async()=>envelope({progress:[progress]}),
 reconcileOutboundProgress:async(...args)=>{calls.push(['reconcile',...args]);return envelope({state:'superseded'});},
 resendEntry:async(...args)=>{calls.push(['resend',...args]);return envelope({kind:'completed',reconciled:[{targetDeviceId:'target',state:'running',current:progress,newTransferRequested:false,duplicateFilesPossible:false}],accepted:0,duplicate:0,offline:0,errored:0,pending:0});},
};
Module._load=function(name,parent,...args){if(name==='react-native')return {Platform:{OS:'ios'}};if(name==='expo-modules-core')return {requireNativeModule:()=>native};return load.call(this,name,parent,...args);};
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
(async()=>{
 const api=require('../../modules/uc-engine/src/index.ts');
 assert.equal((await api.queryOutboundProgress('entry','target')).revision,'18446744073709551615');
 assert.equal((await api.listOutboundProgress())[0].items[0].completedBytes,null);
 assert.equal(await api.reconcileOutboundProgress('entry','target','old-attempt'),'superseded');
 assert.deepEqual(calls.at(-1),['reconcile','entry','target','old-attempt']);
 const outcome=await api.resendEntry('entry',['target']);assert.equal(outcome.reconciled[0].current,progress);assert.deepEqual(calls.at(-1),['resend','entry',['target'],false]);
 failed=true;
 for(const action of [()=>api.queryOutboundProgress('entry','target'),()=>api.listOutboundProgress(),()=>api.reconcileOutboundProgress('entry','target'),()=>api.resendEntry('entry')]) {
   await assert.rejects(action,error=>error instanceof api.UcEngineError&&error.code===1415&&error.category==='unauthorized'&&error.retryable===false);
 }
 const output=process.argv[2] || path.join(root,'e2e/results/outbound-progress/module-replay.json');
 fs.mkdirSync(path.dirname(output),{recursive:true});
 fs.writeFileSync(output,JSON.stringify({passed:true,scope:'Actual TS module boundary; controlled native envelopes, no native App runtime.',checks:['query/list complete views','exact revision and null','expected attempt forwarded','classification kept separate','resend default false and full current','all four typed authorization failures preserved']},null,2)+'\n');
 console.log('TS native-module flow passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
