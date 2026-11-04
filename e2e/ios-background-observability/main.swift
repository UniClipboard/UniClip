import Foundation

let output = URL(fileURLWithPath: CommandLine.arguments[1])
let profile = output.appendingPathComponent("synthetic-profile")
let loggingHost = IsolatedHost(profile)
var checks: [String: Bool] = [:]
var probes: [[String: Any]] = []
var lease: URL!

func leaseIsFree() -> Bool {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
  process.arguments = ["-c", "import fcntl,sys\nf=open(sys.argv[1], 'r+')\ntry: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\nexcept BlockingIOError: sys.exit(1)", lease.path]
  do { try process.run(); process.waitUntilExit(); return process.terminationStatus == 0 }
  catch { return false }
}

enum P2pSharedStore {
  static func networkLogRoot() -> URL? { profile.appendingPathComponent("private/logs/network") }
}

// The app's real setup uses the same network budget and generated binding.
final class DiagnosticHost {
  func prepareDiagnosticLogging() throws {
    if (try? queryLocalDiagnosticStatus()) != nil { return }
    NetworkLogHost.configureBeforeInstall(role: .mobileApp)
    _ = try installProcessObservability(config: BindingObservabilityConfig(
      serviceVersion: "2.4.0", environment: .test, appChannel: "test",
      remoteDiagnosticsEnabled: false, collector: nil), host: loggingHost)
  }
}

enum AppleNativeDiagnostics {
  static let journal = NativeRuntimeDiagnostics(directory: output.appendingPathComponent("native-journal"), role: .mainApplication)
  static func observe<Result>(_ event: NativeDiagnosticEvent, trigger: NativeDiagnosticTrigger = .unspecified,
                              _ operation: () throws -> Result) rethrows -> Result {
    let token = journal.begin(event, trigger: trigger)
    do { let value = try operation(); journal.finish(token, outcome: .succeeded); return value }
    catch { journal.finish(token, outcome: .failed); throw error }
  }
}

final class TestModule {
  let host = DiagnosticHost()
  // PRODUCTION_LIFECYCLE_INITIALIZER
  static func reportLifecycleError(_ error: Error) { checks["noLifecycleError"] = false }
}

final class Activity: NativeBackgroundActivity, @unchecked Sendable {
  let probesLease: Bool
  init(probesLease: Bool = true) { self.probesLease = probesLease }
  var ends = 0
  var remainingTimeMs: UInt64? { 5_000 }
  var expiration: (@Sendable () -> Void)?
  func onExpiration(_ handler: @escaping @Sendable () -> Void) { expiration = handler }
  func end() {
    ends += 1
    guard probesLease else { return }
    let free = leaseIsFree()
    probes.append(["cycle": probes.count + 1, "networkLeaseFreeAtActivityEnd": free])
    checks["leaseFreeAtEveryActivityEnd"] = (checks["leaseFreeAtEveryActivityEnd"] ?? true) && free
  }
}

func run() throws {
  try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
  let module = TestModule()
  try module.host.prepareDiagnosticLogging()
  let export = try prepareNetworkLogExport(deadlineMs: 5_000)
  lease = URL(fileURLWithPath: export.runDirectory).appendingPathComponent("lease.lock")
  checks["runningLeaseHeldWithoutEngineOrServer"] = !leaseIsFree()
  checks["sourceMatchesPin"] = try queryLocalDiagnosticStatus().sourceCommit == "__ENGINE_SOURCE_COMMIT__"
  checks["noLifecycleError"] = true
  let queue = DispatchQueue(label: "e2e.regular-mode-lifecycle")
  var activities: [Activity] = []
  let coordinator = NativeLifecycleTransitionCoordinator(
    lifecycle: module.lifecycle, queue: queue,
    beginBackgroundActivity: { let activity = Activity(); activities.append(activity); return activity },
    reportBackground: { _, _ in
      AppleNativeDiagnostics.journal.record(.backgroundComplete, trigger: .appBackground)
      // PRODUCTION_JOURNAL_BARRIER
    }
  )
  for cycle in 1...3 {
    coordinator.enterBackground(nil)
    queue.sync {}
    checks["cycle\(cycle)CompletedOnce"] = activities.last?.ends == 1
    // A late native callback must not change files while the process is suspended.
    let journal = AppleNativeDiagnostics.journal
    _ = journal.flush()
    let before = journal.fileURLs().compactMap { try? Data(contentsOf: $0) }
    journal.record(.networkChanged, trigger: .networkChange)
    _ = journal.flush()
    checks["cycle\(cycle)LateJournalWriteRejected"] = before == journal.fileURLs().compactMap { try? Data(contentsOf: $0) }
    coordinator.enterForeground(nil)
    queue.sync {}
    checks["cycle\(cycle)ForegroundReacquiresLease"] = !leaseIsFree()
  }
  // EXTRA_SCENARIOS
  let released = try releaseProcessObservability(deadlineMs: 5_000)
  checks["finalProcessRelease"] = released.report.state == .released || released.observation?.wait(deadlineMs: 5_000).state == .released
  let result: [String: Any] = [
    "scope": "Real pinned process logger, production Swift lifecycle and journal, independent OS lock probes. UIKit activity is modeled. RunningBoard/device NOT RUN.",
    "checks": checks, "passed": checks.values.allSatisfy { $0 }, "probes": probes,
  ]
  try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
    .write(to: output.appendingPathComponent("result.json"))
}

do { try run(); exit(checks.values.allSatisfy { $0 } ? 0 : 1) }
catch {
  FileHandle.standardError.write(Data("Host E2E failed: \(error)\n".utf8))
  exit(2)
}
