#!/usr/bin/env python3
"""Replay immutable Engine ledger bodies without a runtime, profile, or OS clipboard."""
import argparse
import hashlib
import json
import pathlib
import subprocess
ROOT = pathlib.Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--engine-repo', type=pathlib.Path, required=True)
p.add_argument('--output', type=pathlib.Path, required=True)
a = p.parse_args()
out = a.output.resolve(); out.mkdir(parents=True, exist_ok=True)
pin = json.loads((ROOT / 'modules/uc-engine/core-source.json').read_text())['sourceCommit']
path = 'crates/uc-infra-content/src/clipboard/change_origin.rs'
source = subprocess.check_output(['git', '-C', str(a.engine_repo), 'show', f'{pin}:{path}'], text=True)
(out / 'pinned-ledger.rs').write_text(source)
# Retain production data structures and async function bodies. Replace only imports,
# async-trait expansion, logging, and the async mutex adapter for this single-thread replay.
body = source[:source.index('#[cfg(test)]')]
body = body.replace('use async_trait::async_trait;', '').replace('use tokio::sync::Mutex;', '')
body = body.replace('use uc_core::ports::clipboard::{SelfWriteAttribution, SelfWriteLedgerPort, SelfWriteMatch};', '')
body = body.replace('use uc_core::ClipboardChangeOrigin;', '').replace('use uc_observability_contract::uc_debug;', '')
body = body.replace('#[async_trait]', '')
header = '''
#![allow(dead_code)]
macro_rules! uc_debug { ($($token:tt)*) => {}; }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SelfWriteAttribution { Local, Remote }
enum SelfWriteMatch { ByContent(String), ByNextChange(String) }
#[derive(Debug, PartialEq, Eq)]
enum ClipboardChangeOrigin { LocalCapture, LocalRestore, RemotePush }
impl ClipboardChangeOrigin { fn remote_push_anonymous() -> Self { Self::RemotePush } }
trait SelfWriteLedgerPort {
 async fn record_self_write(&self, matching: SelfWriteMatch, attribution: SelfWriteAttribution, ttl: std::time::Duration);
 async fn attribute_observed_change(&self, snapshot_hash: &str) -> ClipboardChangeOrigin;
}
struct Mutex<T>(std::sync::Mutex<T>);
impl<T> Mutex<T> {
 fn new(value:T) -> Self { Self(std::sync::Mutex::new(value)) }
 async fn lock(&self) -> std::sync::MutexGuard<'_,T> { self.0.lock().unwrap() }
}
fn run<F: std::future::Future>(future: F) -> F::Output {
 struct Noop;
 impl std::task::Wake for Noop { fn wake(self: std::sync::Arc<Self>) {} }
 let waker = std::task::Waker::from(std::sync::Arc::new(Noop));
 let mut context = std::task::Context::from_waker(&waker);
 let mut future = std::pin::pin!(future);
 match future.as_mut().poll(&mut context) {
   std::task::Poll::Ready(value) => value,
   std::task::Poll::Pending => panic!("Unexpected scheduling dependency"),
 }
}
'''
main = '''
fn main() { run(async {
 let ledger = InMemorySelfWriteLedger::new();
 let key = "files:received-materialized-path";
 ledger.record_self_write(SelfWriteMatch::ByContent(key.into()), SelfWriteAttribution::Remote, Duration::from_secs(60)).await;
 ledger.record_self_write(SelfWriteMatch::ByNextChange(key.into()), SelfWriteAttribution::Remote, Duration::from_secs(60)).await;
 let projected = ledger.attribute_observed_change("text:sender-path-projection").await;
 assert_eq!(projected, ClipboardChangeOrigin::LocalCapture);
 println!("CONTRACT_GAP file-write/text-observation={:?}", projected);
 let user = ledger.attribute_observed_change("files:unrelated-user-file").await;
 assert_eq!(user, ClipboardChangeOrigin::RemotePush);
 println!("CONTRACT_GAP subsequent-unrelated-file-copy={:?}", user);
 let no_record = InMemorySelfWriteLedger::new();
 assert_eq!(no_record.attribute_observed_change("text:genuine-user-copy").await, ClipboardChangeOrigin::LocalCapture);
 let exact = InMemorySelfWriteLedger::new();
 exact.record_self_write(SelfWriteMatch::ByContent("text:exact".into()), SelfWriteAttribution::Remote, Duration::from_secs(60)).await;
 assert_eq!(exact.attribute_observed_change("text:exact").await, ClipboardChangeOrigin::RemotePush);
 assert_eq!(exact.attribute_observed_change("text:genuine-next").await, ClipboardChangeOrigin::LocalCapture);
 println!("CONTROL_PASS exact-content-only record suppresses echo and preserves different user content");
}); }
'''
(out / 'main.rs').write_text(header + body + main)
commands = [['rustc', '--edition=2021', str(out / 'main.rs'), '-o', str(out / 'replay')], [str(out / 'replay')]]
receipt = {'scope': 'Controlled pinned Engine ledger bodies; standard mutex adapter and synthetic guard keys. No full Engine/OS or issue causal proof.', 'engineCommit': pin, 'sourcePath': path, 'sourceSha256': hashlib.sha256(source.encode()).hexdigest(), 'commands': []}
for i, command in enumerate(commands):
 r = subprocess.run(command, text=True, capture_output=True, timeout=90)
 (out / f'command-{i}.log').write_text(r.stdout + r.stderr)
 receipt['commands'].append({'argv': command, 'exitCode': r.returncode})
 if r.returncode: break
receipt['replayed'] = len(receipt['commands']) == 2 and all(c['exitCode'] == 0 for c in receipt['commands'])
receipt['acceptancePassed'] = False
receipt['reason'] = 'Projection and next-change attribution cannot prove write-generation identity.'
(out / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt))
raise SystemExit(0 if receipt['replayed'] else 1)
