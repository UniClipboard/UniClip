import Foundation

final class RealLifecycle: NativeEngineLifecycle, @unchecked Sendable {
  let engine: MobileEngine
  var resumes = 0
  var queries = 0
  init(_ engine: MobileEngine) { self.engine = engine }
  func recoverSession() throws -> NativeSessionRecovery {
    let result = try engine.recoverSession(allowSecureStorageUnlock: true)
    return .init(unlocked: result.unlocked, resumed: result.resumed)
  }
  func lifecycleState() throws -> NativeEngineLifecycleState {
    queries += 1
    switch try engine.lifecycleState() {
    case .running: return .running
    case .quiescing: return .quiescing
    case .quiesced: return .quiesced
    case .suspended: return .suspended
    case .shuttingDown: return .shuttingDown
    case .stopped: return .stopped
    }
  }
  func suspend(deadlineMs: UInt64?) throws {
    do { try engine.suspendWithDeadline(deadlineMs: deadlineMs ?? 15_000) }
    catch BindingError.Engine(_, .deadlineExceeded, _) { throw NativeLifecycleError.deadlineExceeded }
  }
  func resume() throws { resumes += 1; try engine.resume() }
  func notifyForegroundOpportunity() throws { try engine.notifyConnectivityOpportunity(reason: .foreground) }
}
final class TestActivity: NativeBackgroundActivity, @unchecked Sendable {
  var ends = 0
  var remainingTimeMs: UInt64? { 15_000 }
  func end() { ends += 1 }
}
func stage(_ name: String) { FileHandle.standardError.write(Data((name + "\n").utf8)) }
let root = URL(fileURLWithPath: CommandLine.arguments[1])
let storage = root.appendingPathComponent("synthetic-profile")
try FileManager.default.createDirectory(at: storage, withIntermediateDirectories: true)
let host = IsolatedHost(storage)
_ = try installProcessObservability(config: BindingObservabilityConfig(serviceVersion: "1.0.0", environment: .test,
  appChannel: "test", remoteDiagnosticsEnabled: false, collector: nil), host: host)
stage("engine.start")
let engine = try MobileEngine.start(config: BindingConfig(appVersion: "1.0.0", profileId: "default"), host: host)
let adapter = RealLifecycle(engine)
let ownership = P2pRuntimeOwnership(lockURL: storage.appendingPathComponent("runtime.lock"))
let acquired = try ownership.acquire(timeoutMs: 1000)
precondition(acquired)
let owned = RuntimeOwnedNativeLifecycle(engine: adapter, ownership: ownership)
let lifecycle = NativeLifecycleHost(report: { error in fatalError("unexpected lifecycle error: \(error)") })
stage("native.prepare")
try lifecycle.prepare(owned)
stage("space.create")
_ = try engine.createSpace(deviceName: "Synthetic crash199 host", passphrase: "Synthetic regression passphrase")
let text = "Synthetic encrypted data survives native background admission"
stage("text.send")
let entry = try engine.sendText(text: text, targetDevices: []).entryId
let queue = DispatchQueue(label: "test.real.lifecycle")
let bridge = DispatchQueue(label: "test.real.bridge-model")
let activity = TestActivity()
let coordinator = NativeLifecycleTransitionCoordinator(lifecycle: lifecycle, queue: queue, beginBackgroundActivity: { activity })
let gate = DispatchSemaphore(value: 0), enqueued = DispatchSemaphore(value: 0)
var events: [[String: String]] = []
func event(_ name: String) { events.append(["event": name, "monotonicNs": String(DispatchTime.now().uptimeNanoseconds)]) }
event("request.queued")
bridge.async { enqueued.signal(); precondition(gate.wait(timeout: .now() + 30) == .success); try! lifecycle.resumeIfNeeded(owned) }
precondition(enqueued.wait(timeout: .now() + 5) == .success)
stage("background")
coordinator.enterBackground(owned); queue.sync {}
event("background.suspend.complete")
let reads = adapter.queries
let suspended = try engine.lifecycleState() == .suspended
gate.signal(); bridge.sync {}
event("queued.request.return")
let denied = adapter.resumes == 0 && adapter.queries == reads
let probe = P2pRuntimeOwnership(lockURL: storage.appendingPathComponent("runtime.lock"))
let released = try probe.acquire(timeoutMs: 0)
probe.release()
stage("foreground")
coordinator.enterForeground(owned); queue.sync {}
event("foreground.resume.complete")
let foreground = try engine.lifecycleState() == .running && adapter.resumes == 1
stage("text.restore")
let restored = try engine.restoreClipboard(entryId: entry, mode: .standard) == .restored
let actual: Data?
if let representation = host.lastClipboard()?.representations.first, case let .inline(_, _, bytes) = representation {
  actual = bytes
} else { actual = nil }
stage("engine.shutdown")
try engine.shutdown(deadlineMs: 15_000)
ownership.release()
_ = try flushProcessObservability(deadlineMs: 2000)
let checks = ["realEngineInitiallySuspended": suspended, "queuedResumeDeniedWithoutStateRead": denied,
  "actualRuntimeFlockReleased": released, "foregroundRecovered": foreground,
  "encryptedHistoryRestored": restored && actual == Data(text.utf8), "activityEndedOnce": activity.ends == 1]
let result: [String: Any] = ["scope": "Real pinned Engine + Swift lifecycle host + SQLite/encrypted storage + real flock; modeled bridge queue and activity; no Expo/UIKit/RunningBoard",
  "passed": checks.values.allSatisfy { $0 }, "checks": checks, "events": events]
try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]).write(to: root.appendingPathComponent("result.json"))
exit(checks.values.allSatisfy { $0 } ? 0 : 1)
