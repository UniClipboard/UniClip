// Nonvisual product flow replay. Native boundary is controlled; no device claims.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const Module = require('node:module');
const root = path.resolve(__dirname, '../..');
const original = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...args) {
  return original.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, parent, ...args);
};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, filename);
const receipts = [];
async function check(name, run) { await run(); receipts.push({name, result:'PASS', scope:'controlled native boundary, actual product TypeScript'}); }
const summary = (target, state, revision = '18446744073709551615') => ({entryId:'entry', targetDeviceId:target, attemptId:'attempt', revision, freshness:'live', freshnessAvailable:true, state, itemsTotal:1, itemsWaiting:0, itemsRunning:state==='processing'?1:0, itemsCompleted:state==='completed'?1:0, itemsFailed:state==='failed'?1:0, itemsCancelled:0, itemsUnconfirmed:state==='unconfirmed'?1:0, items:[{kind:'file', index:0, state, lastKnownPhase:'processing', round:null, completedBytes:null, totalBytes:null, failureReason:null, cancellationReason:null}]});
(async () => {
  const {OutboundProgressProjection} = require('../../src/platform/engine/outboundProgressProjection.ts');
  const {OutboundDeliveryCoordinator} = require('../../src/features/transfer/internal/outboundDeliveryCoordinator.ts');
  await check('full snapshot preserves targets, maximum u64 and null', async () => {
    const p = new OutboundProgressProjection(async () => [summary('one','processing'), summary('two','failed')]);
    await p.refresh();
    assert.equal(p.getSnapshot().progress.length,2);
    assert.equal(p.getSnapshot().progress[0].revision,'18446744073709551615');
    assert.equal(p.getSnapshot().progress[0].items[0].totalBytes,null);
  });
  await check('read failure preserves previous facts and marks unavailable', async () => {
    let fail=false;
    const p=new OutboundProgressProjection(async()=>{if(fail)throw Error('read unavailable');return [summary('one','processing')];});
    await p.refresh(); fail=true; await p.refresh();
    assert.equal(p.getSnapshot().available,false); assert.equal(p.getSnapshot().progress[0].state,'processing');
  });
  await check('invalidation during a read forces another full read', async () => {
    let release; let calls=0;
    const p=new OutboundProgressProjection(async()=>{calls++; if(calls===1)await new Promise(r=>release=r);return [summary('one',calls===1?'processing':'completed')];});
    const first=p.refresh(); p.refresh(); release(); await first;
    assert.equal(calls,2); assert.equal(p.getSnapshot().progress[0].state,'completed');
  });
  await check('legacy terminal events cannot finish a file; snapshot terminal does', async () => {
    let listener; let state='processing';
    const source={async listDevices(){return [{deviceId:"one",isLocal:false},{deviceId:"two",isLocal:false}];},subscribeEvents(fn){listener=fn; return ()=>{};},async listOutboundProgress(){return [summary('one',state),summary('two','failed')];}};
    const coordinator=new OutboundDeliveryCoordinator(source,100);
    let done=false;
    const result=coordinator.run(async()=>({entryId:'entry',totalAccepted:2,totalPending:0,totalDuplicate:0,totalErrored:0,totalOffline:0})).then(x=>{done=true;return x;});
    await new Promise(r=>setTimeout(r,10)); listener({type:'transferStatusChanged',status:'completed',entryId:'entry',transferId:'old'});
    await new Promise(r=>setTimeout(r,10)); assert.equal(done,false);
    state='completed'; listener({type:'outboundProgressChanged'});
    const outcome=await result; assert.equal(outcome.completed,1); assert.equal(outcome.failed,1);
  });
  await check('local wait expiry preserves unknown without claiming failure', async () => {
    const c=new OutboundDeliveryCoordinator({async listDevices(){return [{deviceId:"one",isLocal:false}];},subscribeEvents(){return ()=>{};},async listOutboundProgress(){return [summary('one','unconfirmed')];}},10);
    const out=await c.run(async()=>({entryId:'entry',totalAccepted:1,totalPending:0,totalDuplicate:0,totalErrored:0,totalOffline:0}));
    assert.equal(out.completed,0); assert.equal(out.failed,0); assert.equal(out.pending,1);
  });
  await check('a previous runtime read cannot republish old facts after reset', async () => {
    let release;
    const p = new OutboundProgressProjection(async () => { await new Promise(r => release=r); return [summary('one','completed')]; });
    const read=p.refresh(); p.reset(); release(); await read;
    assert.equal(p.getSnapshot().progress.length,0); assert.equal(p.getSnapshot().available,false);
  });
  await check('another target historical result cannot satisfy the selected target', async () => {
    const c=new OutboundDeliveryCoordinator({subscribeEvents(){return ()=>{};},async listDevices(){return [{deviceId:'one',isLocal:false}];},async listOutboundProgress(){return [summary('unselected','completed'),summary('one','processing')];}},10);
    const out=await c.run(async()=>({entryId:'entry',totalAccepted:1,totalDuplicate:0,totalPending:0,totalOffline:0,totalErrored:0}),['one']);
    assert.equal(out.completed,0); assert.equal(out.pending,1);
  });
  const output=process.argv[2] || path.join(root,'e2e/results/outbound-progress/ts-replay.json');
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify({scope:'Nonvisual product flow. Controlled native responses. No real Engine/App/device execution.',receipts},null,2)+'\n');
  console.log(`${receipts.length} product-flow scenarios passed; ${output}`);
})().catch(error=>{console.error(error);process.exitCode=1;});
