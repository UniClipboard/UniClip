import Foundation
import SQLite3
import Darwin

#if BASELINE
// The baseline lacks these APIs. These adapters preserve the missing behavior.
final class SharedStorageAccess: @unchecked Sendable {
  static let shared = SharedStorageAccess()
  var generation: UInt64 { 0 }
  var isOpen: Bool { true }
  func requireOpen() throws {}
  func withAccess<T>(_ work: () throws -> T) throws -> T { try work() }
  func suspend(completion: @escaping () -> Void = {}) { completion() }
  func resume() {}
}
extension HistoryLog {
  func suspend() -> Bool { true }
  func resume() {}
}
#endif

enum AnalyticsAcceptanceCallback {
  static let queued = DispatchSemaphore(value: 0)
}

// Intercept only the fixture request. No event reaches an external endpoint.
final class HeldAnalyticsProtocol: URLProtocol, @unchecked Sendable {
  static let entered = DispatchSemaphore(value: 0)
  private static let lock = NSLock()
  private static var held: HeldAnalyticsProtocol?
  override class func canInit(with request: URLRequest) -> Bool {
    request.url?.host == "127.0.0.1" && request.url?.path == "/fixture"
  }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    Self.lock.withLock { Self.held = self }
    Self.entered.signal()
  }
  override func stopLoading() {}
  static func respondOK() {
    guard let instance = lock.withLock({ held }) else { return }
    let response = HTTPURLResponse(url: instance.request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: nil)!
    instance.client?.urlProtocol(instance, didReceive: response, cacheStoragePolicy: .notAllowed)
    instance.client?.urlProtocolDidFinishLoading(instance)
    lock.withLock { held = nil }
  }
}

@main
struct SuspensionAcceptance {
  static func main() async throws {
    if CommandLine.arguments[1] == "probe" {
      let owner = P2pRuntimeOwnership(lockURL: URL(fileURLWithPath: CommandLine.arguments[2]))
      let acquired = try owner.acquire(timeoutMs: 0)
      owner.release()
      exit(acquired ? 0 : 2)
    }
    let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    let output = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
    var results: [[String: Any]] = []
    func check(_ passed: Bool, _ name: String) {
      results.append(["name": name, "passed": passed]); print("\(passed ? "PASS" : "FAIL"): \(name)")
    }
    func journalBytes(_ directory: URL) -> Int {
      ((try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? [])
        .filter { $0.pathExtension == "jsonl" }.reduce(0) { $0 + ((try? Data(contentsOf: $1).count) ?? 0) }
    }
    let access = SharedStorageAccess.shared
    access.resume()

    var finished = false
    let host = NativeHostSuspension { _, _ in }
    host.setParticipating(true)
    host.suspend(transitionId: 1) { finished = true }
    #if BASELINE
    // UcEngineModule ignores released=false and calls complete unconditionally.
    _ = host.complete(transitionId: 1)
    #else
    _ = host.complete(transitionId: 1, released: false)
    #endif
    check(!finished, "negative release acknowledgement retains pending owner")
    #if !BASELINE
    _ = host.complete(transitionId: 1, released: true)
    #endif
    check(finished, "successful release acknowledgement completes owner")

    let entered = DispatchSemaphore(value: 0), release = DispatchSemaphore(value: 0), drained = DispatchSemaphore(value: 0)
    let workDone = DispatchSemaphore(value: 0)
    DispatchQueue.global().async {
      try! access.withAccess { entered.signal(); release.wait() }
      workDone.signal()
    }
    precondition(entered.wait(timeout: .now() + 5) == .success)
    access.suspend { drained.signal() }
    check(drained.wait(timeout: .now() + .milliseconds(30)) == .timedOut, "accepted storage work keeps drain pending")
    do { try access.requireOpen(); check(false, "suspension denies new shared storage operations") }
    catch { check(true, "suspension denies new shared storage operations") }
    release.signal(); precondition(workDone.wait(timeout: .now()+5) == .success)
    #if !BASELINE
    check(drained.wait(timeout: .now()+5) == .success, "drain completes after actual storage operation return")
    #else
    check(true, "baseline drain adapter has no tracked operations")
    #endif
    access.resume()

    let diag = root.appendingPathComponent("diagnostics", isDirectory: true)
    let journal = NativeRuntimeDiagnostics(directory: diag, role: .keyboardExtension)
    precondition(journal.flush())
    let before = journalBytes(diag)
    let lockOwner = P2pRuntimeOwnership(lockURL: diag.appendingPathComponent(".native-runtime.lock"))
    let acquired = try lockOwner.acquire(timeoutMs: 0)
    precondition(acquired)
    let operation = journal.begin(.engineSuspend, trigger: .extensionHidden)
    // The writer cannot mutate the journal while the competing lock is held.
    Thread.sleep(forTimeInterval: 0.02)
    access.suspend()
    lockOwner.release()
    precondition(journal.flush())
    journal.record(.ownershipRelease, trigger: .runtimeHandoff)
    precondition(journal.flush())
    check(journalBytes(diag) == before, "queued and late diagnostics cannot write after storage suspension")
    access.resume()
    journal.finish(operation, outcome: .succeeded)
    precondition(journal.flush())
    check(journalBytes(diag) == before, "old diagnostic finish cannot write after resume")
    journal.record(.extensionVisible, trigger: .extensionVisible)
    precondition(journal.flush())
    check(journalBytes(diag) > before, "new visible generation records diagnostics")

    let historyRoot = root.appendingPathComponent("history", isDirectory: true)
    let dbDir = historyRoot.appendingPathComponent("Databases", isDirectory: true)
    try FileManager.default.createDirectory(at: dbDir, withIntermediateDirectories: true)
    var db: OpaquePointer?
    precondition(sqlite3_open(dbDir.appendingPathComponent("uniclipboard.db").path, &db) == SQLITE_OK)
    let schema = try String(contentsOfFile: CommandLine.arguments[3], encoding: .utf8)
    precondition(sqlite3_exec(db, "PRAGMA journal_mode=WAL;" + schema, nil, nil, nil) == SQLITE_OK)
    sqlite3_close(db)
    let suite = "ios-suspension-\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: suite)!
    defer { defaults.removePersistentDomain(forName: suite) }
    let store = SettingsStore(defaults: defaults, containerURL: historyRoot)
    let history = HistoryLog(store: store, containerURL: historyRoot)
    let item = Clipboard(type: .text, hash: "AABB", text: "synthetic", hasData: false)
    check(history.append(entry: item, direction: .local), "history opens and writes synthetic row")
    check((NativeDiagnosticFiles.openFiles(under: historyRoot)?.database ?? 0) > 0, "descriptor probe observes the running SQLite owner")
    check(history.suspend(), "history owner reports close result")
    check((NativeDiagnosticFiles.openFiles(under: historyRoot)?.database ?? -1) == 0, "history suspension closes real SQLite descriptors")
    check(!history.append(entry: item, direction: .local), "history suspension rejects late database and fallback writes")
    history.resume()
    check(history.loadRecent(limit: 10).count == 1, "history resume preserves data and lazily reopens SQLite")
    check(history.suspend(), "history closes after resumed read")
    #if !BASELINE
    var registeredHistory: HistoryLog? = HistoryLog(store: store, containerURL: historyRoot)
    _ = registeredHistory!.loadRecent(limit: 10)
    weak var retainedHistory = registeredHistory
    registeredHistory = nil
    check(retainedHistory != nil && (NativeDiagnosticFiles.openFiles(under: historyRoot)?.database ?? 0) > 0,
      "registered SQLite owner survives its caller until actual close")
    access.suspend()
    check(retainedHistory == nil && (NativeDiagnosticFiles.openFiles(under: historyRoot)?.database ?? -1) == 0,
      "global admission close closes and releases the registered SQLite owner")
    let admissionHistory = HistoryLog(store: store, containerURL: historyRoot)
    access.resume()
    let reopenedRows = admissionHistory.loadRecent(limit: 10)
    access.suspend()
    access.resume()
    check(admissionHistory.loadRecent(limit: 10).count == reopenedRows.count && reopenedRows.count == 1,
      "admission-owned history reopens after foreground without changing component suspension")
    access.suspend()
    #else
    access.suspend()
    #endif

    access.resume()
    let cacheRoot = root.appendingPathComponent("payloads", isDirectory: true)
    let cache = PayloadCache(directory: cacheRoot, maxBytes: 1024 * 1024)
    let fetchEntered = DispatchSemaphore(value: 0), fetchReturn = DispatchSemaphore(value: 0)
    let fetch = Task.detached {
      try await cache.fetchAndStore(profileId: "Text-SYNTHETIC") {
        fetchEntered.signal(); fetchReturn.wait()
        return Data("synthetic".utf8)
      }
    }
    precondition(fetchEntered.wait(timeout: .now()+5) == .success)
    access.suspend(); access.resume(); fetchReturn.signal()
    do { _ = try await fetch.value; check(false, "old payload fetch cannot write in the resumed generation") }
    catch { check(true, "old payload fetch cannot write in the resumed generation") }
    check(!FileManager.default.fileExists(atPath: cacheRoot.appendingPathComponent("Text-SYNTHETIC").path), "late fetch creates no payload file")
    #if !MODULE_STORAGE
    let stagedPayload = root.appendingPathComponent("synthetic.staged")
    try Data("synthetic".utf8).write(to: stagedPayload)
    access.suspend()
    do { _ = try await cache.writeFile(profileId: "File-SYNTHETIC", from: stagedPayload); check(false, "suspended Share payload copy is denied") }
    catch { check(true, "suspended Share payload copy is denied") }
    check(!FileManager.default.fileExists(atPath: cacheRoot.appendingPathComponent("File-SYNTHETIC").path), "suspended Share copy creates no payload file")
    access.resume()
    #endif
    let attempts = try ShareDiagnosticsStore(containerURL: root)
    let recorder = try attempts.startAttempt(itemKind: .text, byteCount: 9)
    let attemptFile = root.appendingPathComponent("Library/Caches/UniClipDiagnostics/share-attempts/\(recorder.attemptID).json")
    let attemptBefore = try Data(contentsOf: attemptFile)
    access.suspend()
    recorder.record(stage: .failed)
    check(try Data(contentsOf: attemptFile) == attemptBefore, "suspended Share diagnostics cannot write")
    access.resume(); recorder.record(stage: .failed)
    check(try Data(contentsOf: attemptFile) == attemptBefore, "old Share recorder cannot write after resume")

    final class ManualGrant: NativeBackgroundActivity, @unchecked Sendable {
      let lock = NSLock()
      private var ended = false
      private var expiration: (@Sendable () -> Void)?
      var isEnded: Bool { lock.withLock { ended } }
      var remainingTimeMs: UInt64? { 1000 }
      func end() { lock.withLock { ended = true } }
      func onExpiration(_ handler: @escaping @Sendable () -> Void) { lock.withLock { expiration = handler } }
      func expire() { lock.withLock { expiration }?(); end() }
    }
    let held = DispatchSemaphore(value: 0), finishHeld = DispatchSemaphore(value: 0), actualDone = DispatchSemaphore(value: 0)
    DispatchQueue.global().async {
      try! access.withAccess { held.signal(); finishHeld.wait() }
      actualDone.signal()
    }
    precondition(held.wait(timeout: .now()+5) == .success)
    let grant = ManualGrant(), transitionQueue = DispatchQueue(label: "acceptance.background")
    let coordinator = NativeLifecycleTransitionCoordinator(lifecycle: NativeLifecycleHost(report: { _ in }), queue: transitionQueue, beginBackgroundActivity: { grant })
    coordinator.enterBackground(nil); transitionQueue.sync {}
    check(!grant.isEnded, "native storage operation keeps actual background grant part pending")
    check(!access.isOpen, "background coordinator closes storage admission")
    coordinator.enterForeground(nil); transitionQueue.sync {}; grant.expire()
    check(access.isOpen, "old grant expiration cannot close a newer foreground generation")
    finishHeld.signal(); precondition(actualDone.wait(timeout: .now()+5) == .success)
    access.suspend()

    // Exercise failure through the real extension lifecycle and a child flock probe.
    final class FailingEngine {}
    enum StopFailure: Error { case notFinished }
    let retryLock = NSLock()
    var allowShutdown = false
    let lockURL = root.appendingPathComponent("failed-stop.runtime.lock")
    func canAcquire() throws -> Bool {
      let child = Process()
      child.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
      child.arguments = ["probe", lockURL.path]
      try child.run(); child.waitUntilExit()
      precondition([0, 2].contains(child.terminationStatus))
      return child.terminationStatus == 0
    }
    var extensionOwner: ExtensionRuntimeLifecycle<FailingEngine>? = ExtensionRuntimeLifecycle(
      ownership: P2pRuntimeOwnership(lockURL: lockURL), suspend: { _ in throw StopFailure.notFinished }, shutdown: { _ in
        #if BASELINE
        // The old controller swallows the shutdown error before this callback returns.
        return
        #else
        guard retryLock.withLock({ allowShutdown }) else { throw NativeReleaseOutcome.pending }
        #endif
      }
    )
    _ = try extensionOwner!.startEngine { FailingEngine() }
    try extensionOwner!.finishStartup()
    try? extensionOwner!.stopForSuspension()
    extensionOwner = nil
    check(try !canAcquire(), "Pending final shutdown retains runtime ownership after caller release")
    retryLock.withLock { allowShutdown = true }
    var released = false
    for _ in 0..<100 {
      if try canAcquire() { released = true; break }
      Thread.sleep(forTimeInterval: 0.01)
    }
    check(released, "confirmed shutdown releases ownership after retained cleanup")

    final class PendingEngine: NativeEngineLifecycle {
      var state: NativeEngineLifecycleState = .quiescing
      func recoverSession() throws -> NativeSessionRecovery { .init(unlocked: true, resumed: true) }
      func lifecycleState() throws -> NativeEngineLifecycleState { state }
      func suspend(deadlineMs: UInt64?) throws { state = .suspended }
      #if !BASELINE
      func suspendOutcome(deadlineMs: UInt64) -> NativeReleaseOutcome {
        if state == .shuttingDown { return .pending }
        state = .suspended
        return .released(error: nil)
      }
      #endif
      func resume() throws { state = .running }
      func notifyForegroundOpportunity() throws {}
    }
    let pendingEngine = PendingEngine()
    let pendingLock = root.appendingPathComponent("quiescing.runtime.lock")
    let pendingOwnership = P2pRuntimeOwnership(lockURL: pendingLock)
    let pendingAcquired = try pendingOwnership.acquire(timeoutMs: 0)
    precondition(pendingAcquired)
    let pendingLifecycle = RuntimeOwnedNativeLifecycle(engine: pendingEngine, ownership: pendingOwnership)
    #if !BASELINE
    let pendingGeneration = pendingLifecycle.prepareRelease {}
    pendingLifecycle.confirmFile(.nativeFiles, generation: pendingGeneration)
    pendingLifecycle.confirmFile(.hostFiles, generation: pendingGeneration)
    pendingLifecycle.confirmFile(.processObservability, generation: pendingGeneration)
    #endif
    let pendingHost = NativeLifecycleHost(report: { _ in })
    let pendingFinished = pendingHost.enterBackground(pendingLifecycle, remainingTimeMs: { 1000 })
    let independent = Process()
    independent.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
    independent.arguments = ["probe", pendingLock.path]
    try independent.run(); independent.waitUntilExit()
    check(pendingFinished && independent.terminationStatus == 0, "complete Engine result plus independent file acknowledgements release ownership")
    pendingOwnership.release()
    pendingEngine.state = .shuttingDown
    #if !BASELINE
    let shuttingDownOwner = RuntimeOwnedNativeLifecycle(engine: pendingEngine, ownership: pendingOwnership)
    #else
    let shuttingDownOwner = pendingEngine
    #endif
    check(!pendingHost.enterBackground(shuttingDownOwner, remainingTimeMs: { 1000 }), "ShuttingDown alone cannot report successful suspension")

    access.resume()
    let keyboardJournal = KeyboardDiagnostics()
    keyboardJournal.flushForAcceptance()
    let keyboardFile = root.appendingPathComponent("keyboard.jsonl")
    let keyboardBefore = try Data(contentsOf: keyboardFile)
    access.suspend()
    keyboardJournal.record("late.hidden")
    keyboardJournal.recordView("synthetic", signature: "hidden")
    keyboardJournal.flushForAcceptance()
    check(try Data(contentsOf: keyboardFile) == keyboardBefore, "keyboard diagnostic producer denies records while storage is suspended")
    access.resume()
    let queueHeld = DispatchSemaphore(value: 0), queueReturn = DispatchSemaphore(value: 0)
    keyboardJournal.holdQueueForAcceptance(entered: queueHeld, release: queueReturn)
    precondition(queueHeld.wait(timeout: .now()+5) == .success)
    keyboardJournal.record("old.queued")
    access.suspend(); access.resume(); queueReturn.signal()
    keyboardJournal.flushForAcceptance()
    check(try Data(contentsOf: keyboardFile) == keyboardBefore, "queued keyboard diagnostics cannot cross a visible generation")
    keyboardJournal.record("new.visible")
    keyboardJournal.flushForAcceptance()
    check(try Data(contentsOf: keyboardFile).count > keyboardBefore.count, "new visible keyboard generation can record")
    access.suspend()

    access.resume()
    let analyticsQueue = root.appendingPathComponent("analytics/queue", isDirectory: true)
    let analytics = try AppleAnalyticsStore(defaults: defaults, queueDirectory: analyticsQueue)
    try analytics.enqueue(Data("{\"fixture\":true}".utf8))
    let analyticsFiles = analytics.pendingEvents()
    check(analyticsFiles.count == 1, "analytics queue records synthetic event before suspension")
    access.suspend()
    do { try analytics.enqueue(Data("{\"late\":true}".utf8)); check(false, "suspended analytics cannot append a shared queue file") }
    catch { check(true, "suspended analytics cannot append a shared queue file") }
    analytics.remove(analyticsFiles[0])
    check(FileManager.default.fileExists(atPath: analyticsFiles[0].path), "suspended analytics cannot remove a shared queue file")
    check(analytics.pendingEvents().isEmpty, "suspended analytics cannot enumerate delivery work")
    access.resume()
    check(analytics.pendingEvents().count == 1, "analytics queue survives until foreground delivery")
    access.suspend()

    access.resume()
    // Reserve a non-listening socket, so failed interception cannot contact another service.
    let socketFD = socket(AF_INET, SOCK_STREAM, 0)
    precondition(socketFD >= 0)
    defer { Darwin.close(socketFD) }
    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_addr.s_addr = inet_addr("127.0.0.1")
    let bound = withUnsafePointer(to: &address) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(socketFD, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
    }
    precondition(bound == 0)
    var length = socklen_t(MemoryLayout<sockaddr_in>.size)
    let named = withUnsafeMutablePointer(to: &address) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(socketFD, $0, &length) }
    }
    precondition(named == 0)
    precondition(URLProtocol.registerClass(HeldAnalyticsProtocol.self))
    defer { URLProtocol.unregisterClass(HeldAnalyticsProtocol.self) }
    let endpoint = URL(string: "http://127.0.0.1:\(UInt16(bigEndian: address.sin_port))/fixture")!
    let deliveryStore = try AppleAnalyticsStore(defaults: defaults, queueDirectory: root.appendingPathComponent("analytics/delivery"))
    try deliveryStore.enqueue(Data("{\"fixture\":true}".utf8))
    let deliveryFile = deliveryStore.pendingEvents()[0]
    let analyticsHost = try ApplePostHogAnalyticsHost(appVersion: "fixture", store: deliveryStore, projectKey: "fixture", endpoint: endpoint)
    let intercepted = HeldAnalyticsProtocol.entered.wait(timeout: .now()+5) == .success
    check(intercepted, "analytics delivery reaches the controlled Foundation protocol")
    if intercepted {
      access.suspend(); access.resume()
      HeldAnalyticsProtocol.respondOK()
      precondition(AnalyticsAcceptanceCallback.queued.wait(timeout: .now()+5) == .success)
      analyticsHost.flushDeliveryForAcceptance()
      check(FileManager.default.fileExists(atPath: deliveryFile.path), "old delivery acknowledgement cannot delete a queue file after resume")
    }
    access.suspend()

    let receipt: [String: Any] = ["scope": "macOS native/storage E2E; manual grants and controlled Engine; iOS and real Engine NOT RUN", "cases": results, "passed": results.allSatisfy { $0["passed"] as? Bool == true }]
    try JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys]).write(to: output.appendingPathComponent("cases.json"))
    if !results.allSatisfy({ $0["passed"] as? Bool == true }) { exit(1) }
  }
}
