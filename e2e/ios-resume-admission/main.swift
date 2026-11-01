import Foundation
import Darwin

final class Trace: @unchecked Sendable {
  let lock = NSLock()
  var events: [[String: Any]] = []
  func add(_ event: String) {
    lock.withLock { events.append(["event": event, "monotonicNs": String(DispatchTime.now().uptimeNanoseconds)]) }
  }
}
let trace = Trace()
final class Engine: NativeEngineLifecycle, @unchecked Sendable {
  var state: NativeEngineLifecycleState = .running
  var resumes = 0
  var queries = 0
  var opportunities = 0
  func recoverSession() throws -> NativeSessionRecovery {
    trace.add("recover"); return .init(unlocked: false, resumed: false)
  }
  func lifecycleState() throws -> NativeEngineLifecycleState { queries += 1; trace.add("state.read"); return state }
  func suspend(deadlineMs: UInt64?) throws { state = .suspended; trace.add("suspend.complete") }
  func resume() throws { resumes += 1; state = .running; trace.add("resume.file-access") }
  func notifyForegroundOpportunity() throws { opportunities += 1; trace.add("foreground.opportunity") }
}
final class Ownership: NativeRuntimeOwnership {
  let actual: P2pRuntimeOwnership
  var acquisitions = 0
  init(_ path: URL) { actual = P2pRuntimeOwnership(lockURL: path) }
  func acquire(timeoutMs: UInt64) throws -> Bool {
    acquisitions += 1; trace.add("ownership.acquire"); return try actual.acquire(timeoutMs: timeoutMs)
  }
  func release() { actual.release(); trace.add("ownership.release") }
}
final class Activity: NativeBackgroundActivity, @unchecked Sendable {
  var ends = 0
  var remainingTimeMs: UInt64? { 1000 }
  func end() { ends += 1; trace.add("activity.end") }
}
func wait(_ gate: DispatchSemaphore) { precondition(gate.wait(timeout: .now() + 5) == .success, "test gate timeout") }
let output = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
var results: [[String: Any]] = []
func record(_ name: String, _ passed: Bool) { results.append(["scenario": name, "passed": passed]); trace.add("verdict.\(name).\(passed)") }

// A native resume is already enqueued before UIKit's modeled background receipt.
do {
  trace.add("case.queued-resume")
  let engine = Engine(), activity = Activity()
  let ownership = Ownership(output.appendingPathComponent("queued.lock"))
  let owned = RuntimeOwnedNativeLifecycle(engine: engine, ownership: ownership)
  let host = NativeLifecycleHost(report: { _ in preconditionFailure("unexpected transition error") })
  let lifecycleQueue = DispatchQueue(label: "test.lifecycle")
  let operationQueue = DispatchQueue(label: "test.bridge")
  let coordinator = NativeLifecycleTransitionCoordinator(lifecycle: host, queue: lifecycleQueue, beginBackgroundActivity: { activity })
  let release = DispatchSemaphore(value: 0), enqueued = DispatchSemaphore(value: 0)
  operationQueue.async { enqueued.signal(); wait(release); trace.add("request.execute.queued-resume"); try! host.resumeIfNeeded(owned); trace.add("request.return.queued-resume") }
  wait(enqueued)
  trace.add("request.queued.before-background")
  coordinator.enterBackground(owned)
  trace.add("admission.closed.queued-resume")
  lifecycleQueue.sync {}
  let reads = engine.queries
  release.signal(); operationQueue.sync {}
  record("queued-background-resume-denied-before-ownership-and-state-read",
         engine.resumes == 0 && ownership.acquisitions == 0 && engine.queries == reads && activity.ends == 1)
  // A separate runtime can acquire the actual released flock.
  let extensionOwner = P2pRuntimeOwnership(lockURL: output.appendingPathComponent("queued.lock"))
  record("extension-handoff", try extensionOwner.acquire(timeoutMs: 0))
  extensionOwner.release()
  coordinator.enterForeground(owned); lifecycleQueue.sync {}
  record("valid-foreground", engine.resumes == 1 && ownership.acquisitions == 1 && engine.state == .running)
  try host.resumeIfNeeded(owned)
  record("idempotent-foreground", engine.resumes == 1)
  engine.state = .quiesced
  try host.resumeIfNeeded(owned)
  record("quiesced-foreground", engine.resumes == 2)
  ownership.release()
}
// Force foreground admission while the previous suspension's flush is still open.
do {
  trace.add("case.completion-interleave")
  let engine = Engine(), activity = Activity()
  let flushing = DispatchSemaphore(value: 0), release = DispatchSemaphore(value: 0)
  let host = NativeLifecycleHost(report: { _ in }, flushObservability: { trace.add("flush.begin"); flushing.signal(); wait(release); trace.add("flush.end") })
  let lifecycleQueue = DispatchQueue(label: "test.completion")
  let coordinator = NativeLifecycleTransitionCoordinator(lifecycle: host, queue: lifecycleQueue, beginBackgroundActivity: { activity })
  coordinator.enterBackground(engine); wait(flushing)
  coordinator.enterForeground(engine)
  let finished = DispatchSemaphore(value: 0)
  DispatchQueue.global().async { try! host.resumeIfNeeded(engine); finished.signal() }
  let resumedBeforeFlushFinished = finished.wait(timeout: .now() + .milliseconds(200)) == .success
  release.signal(); lifecycleQueue.sync {}
  if !resumedBeforeFlushFinished { wait(finished) }
  record("background-completion-before-admitted-resume", !resumedBeforeFlushFinished && activity.ends == 1 && engine.resumes == 1)
}
// Foreground work queued before a newer background receipt must not resume.
do {
  trace.add("case.rapid-switch")
  let engine = Engine()
  engine.state = .suspended
  let queue = DispatchQueue(label: "test.rapid")
  let release = DispatchSemaphore(value: 0), held = DispatchSemaphore(value: 0)
  queue.async { held.signal(); wait(release) }; wait(held)
  var activities: [Activity] = []
  let host = NativeLifecycleHost(report: { _ in })
  let coordinator = NativeLifecycleTransitionCoordinator(lifecycle: host, queue: queue, beginBackgroundActivity: { let a = Activity(); activities.append(a); return a })
  coordinator.enterForeground(engine)
  coordinator.enterBackground(engine)
  release.signal(); queue.sync {}
  record("superseded-foreground-denied", engine.resumes == 0 && engine.opportunities == 0)
  for _ in 0..<20 { coordinator.enterForeground(engine); coordinator.enterBackground(engine) }
  queue.sync {}
  coordinator.enterForeground(engine); queue.sync {}
  record("rapid-final-foreground-and-no-activity-leak", engine.state == .running && activities.allSatisfy { $0.ends == 1 })
}
// Host file closure can arrive after Engine closure. Foreground must retire the
// old activity before a bridge resume, without reporting obsolete closure.
do {
  trace.add("case.late-host-completion")
  let engine = Engine(), activity = Activity()
  let host = NativeLifecycleHost(report: { _ in })
  let queue = DispatchQueue(label: "test.host-files")
  let suspension = NativeHostSuspension { _, _ in }
  suspension.setParticipating(true)
  let reports = Trace()
  let coordinator = NativeLifecycleTransitionCoordinator(lifecycle: host, queue: queue,
    beginBackgroundActivity: { activity }, hostSuspension: suspension,
    reportBackground: { _, _ in reports.add("background.closed") })
  coordinator.enterBackground(engine); queue.sync {}
  let blocked = DispatchSemaphore(value: 0), release = DispatchSemaphore(value: 0)
  queue.async { blocked.signal(); wait(release) }; wait(blocked)
  coordinator.enterForeground(engine)
  try host.resumeIfNeeded(engine)
  record("foreground-retires-prior-background-activity", activity.ends == 1 && reports.events.isEmpty)
  release.signal(); queue.sync {}
  _ = suspension.complete(transitionId: 1)
  record("late-host-report-cannot-complete-new-runtime", activity.ends == 1 && reports.events.isEmpty)
}
// Startup registration and final preparation must both honor a background
// receipt that arrived before an Engine object existed.
do {
  let engine = Engine()
  let host = NativeLifecycleHost(report: { _ in })
  let queue = DispatchQueue(label: "test.startup")
  let coordinator = NativeLifecycleTransitionCoordinator(lifecycle: host, queue: queue, beginBackgroundActivity: { Activity() })
  coordinator.enterBackground(nil); queue.sync {}
  try host.prepare(engine)
  record("late-startup-preparation-stays-suspended", engine.state == .suspended)
  coordinator.enterForeground(engine); queue.sync {}
  record("late-startup-foreground-recovers", engine.state == .running)
}
let receipt: [String: Any] = ["scope": "macOS native host model; controlled Engine; real flock; no JS bridge/UIKit/Engine/SQLite", "passed": results.allSatisfy { $0["passed"] as? Bool == true }, "results": results, "events": trace.events]
try JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys]).write(to: output.appendingPathComponent("result.json"))
exit(results.allSatisfy { $0["passed"] as? Bool == true } ? 0 : 1)
