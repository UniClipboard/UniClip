import Foundation

private enum ControlledFailure: Error { case release, resume }

private final class TransitionReceipt: @unchecked Sendable {
  private let lock = NSLock()
  private var value = 0
  func set(_ id: Int) { lock.withLock { value = id } }
  var id: Int { lock.withLock { value } }
}

func realEngineScenario(module: TestModule, queue: DispatchQueue) throws {
  let engine = try MobileEngine.start(config: BindingConfig(appVersion: "2.4.0", profileId: "default"), host: loggingHost)
  let runtimeLock = profile.appendingPathComponent("runtime.lock")
  let ownership = P2pRuntimeOwnership(lockURL: runtimeLock)
  let acquired = try ownership.acquire(timeoutMs: 1_000)
  checks["realEngineRuntimeOwnershipAcquired"] = acquired
  let lifecycle = RuntimeOwnedNativeLifecycle(engine: AppleMobileEngineLifecycle(engine: engine), ownership: ownership)
  try module.lifecycle.prepare(lifecycle)
  _ = try engine.createSpace(deviceName: "Synthetic background owner", passphrase: "Synthetic background owner passphrase")
  let text = "Synthetic history survives process log release"
  let entry = try engine.sendText(text: text, targetDevices: []).entryId
  let activity = Activity()
  let coordinator = NativeLifecycleTransitionCoordinator(lifecycle: module.lifecycle, queue: queue,
    beginBackgroundActivity: { activity }, reportBackground: { _, _ in
      AppleNativeDiagnostics.journal.record(.backgroundComplete, trigger: .appBackground)
      return AppleNativeDiagnostics.journal.pause()
    })
  coordinator.enterBackground(lifecycle)
  queue.sync {}
  checks["realEngineSuspendedBeforeActivityEnd"] = try engine.lifecycleState() == .suspended && activity.ends == 1
  let probe = P2pRuntimeOwnership(lockURL: runtimeLock)
  checks["realEngineRuntimeOwnershipReleased"] = try probe.acquire(timeoutMs: 0)
  probe.release()
  coordinator.enterForeground(lifecycle)
  queue.sync {}
  checks["realEngineForegroundRecovered"] = try engine.lifecycleState() == .running && !leaseIsFree()
  checks["realEngineRuntimeOwnershipReacquired"] = try !probe.acquire(timeoutMs: 0)
  let restored = try engine.restoreClipboard(entryId: entry, mode: .standard) == .restored
  var actual: Data?
  if let representation = loggingHost.lastClipboard()?.representations.first,
     case let .inline(_, _, bytes) = representation { actual = bytes }
  checks["realEngineEncryptedHistoryRestored"] = restored && actual == Data(text.utf8)
  try engine.shutdown(deadlineMs: 5_000)
  ownership.release()
}

private final class ControlledEngine: NativeEngineLifecycle {
  var state = NativeEngineLifecycleState.suspended
  var resumes = 0
  var beforeResume: () -> Bool = { true }
  func recoverSession() throws -> NativeSessionRecovery { .init(unlocked: false, resumed: false) }
  func lifecycleState() throws -> NativeEngineLifecycleState { state }
  func suspend(deadlineMs: UInt64?) throws { state = .suspended }
  func resume() throws { precondition(beforeResume()); resumes += 1; state = .running }
  func notifyForegroundOpportunity() throws {}
}

func additionalScenarios() {
  for failed in [false, true] {
    let activity = Activity(probesLease: false)
    var reports = 0
    let lifecycle = NativeLifecycleHost(report: { _ in }, releaseObservability: { _ in
      if failed { throw ControlledFailure.release }
      return false
    })
    let queue = DispatchQueue(label: "e2e.unreleased")
    let coordinator = NativeLifecycleTransitionCoordinator(lifecycle: lifecycle, queue: queue,
      beginBackgroundActivity: { activity }, reportBackground: { _, _ in reports += 1; return true })
    coordinator.enterBackground(nil)
    queue.sync {}
    checks[failed ? "failedReleaseKeepsActivity" : "pendingReleaseKeepsActivity"] = activity.ends == 0 && reports == 0
    coordinator.enterForeground(nil)
    queue.sync {}
  }

  do {
    let activity = Activity(probesLease: false)
    let lifecycle = NativeLifecycleHost(report: { _ in })
    let queue = DispatchQueue(label: "e2e.journal-timeout")
    let coordinator = NativeLifecycleTransitionCoordinator(lifecycle: lifecycle, queue: queue,
      beginBackgroundActivity: { activity }, reportBackground: { _, _ in false })
    coordinator.enterBackground(nil)
    queue.sync {}
    checks["journalTimeoutKeepsActivity"] = activity.ends == 0
    coordinator.enterForeground(nil)
    queue.sync {}
  }

  do {
    var processResumed = false
    let engine = ControlledEngine()
    engine.beforeResume = { processResumed }
    let lifecycle = NativeLifecycleHost(report: { _ in }, resumeObservability: { processResumed = true })
    lifecycle.enterForeground(engine)
    checks["processResumesBeforeEngine"] = processResumed && engine.resumes == 1
    let failed = NativeLifecycleHost(report: { _ in }, resumeObservability: { throw ControlledFailure.resume })
    engine.state = .suspended
    failed.enterForeground(engine)
    checks["failedProcessResumeBlocksEngine"] = engine.resumes == 1
    lifecycle.setForegroundAdmission(false)
    processResumed = false
    lifecycle.enterForeground(nil)
    var installedAfterBackground = false
    lifecycle.performForegroundWork { installedAfterBackground = true }
    checks["staleForegroundDoesNotReopenFiles"] = !processResumed
    checks["queuedLoggerInstallDeniedAfterBackground"] = !installedAfterBackground
  }

  do {
    let activity = Activity(probesLease: false)
    let lifecycle = NativeLifecycleHost(report: { _ in })
    let transition = TransitionReceipt()
    let host = NativeHostSuspension { _, id in transition.set(id) }
    host.setParticipating(true)
    let queue = DispatchQueue(label: "e2e.database-close-failure")
    let coordinator = NativeLifecycleTransitionCoordinator(lifecycle: lifecycle, queue: queue,
      beginBackgroundActivity: { activity }, hostSuspension: host)
    coordinator.enterBackground(nil)
    _ = host.complete(transitionId: transition.id, released: false)
    queue.sync {}
    checks["failedDatabaseCloseKeepsActivity"] = activity.ends == 0
    _ = host.complete(transitionId: transition.id, released: true)
    checks["successfulDatabaseRetryCompletes"] = activity.ends == 1
  }
}
