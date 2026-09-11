import Foundation
import Network

public enum AppleNativeDiagnostics {
  public static let journal = NativeRuntimeDiagnostics(
    directory: P2pSharedStore.diagnosticsDirectory(),
    role: Bundle.main.bundleIdentifier?.hasSuffix(".Keyboard") == true ? .keyboardExtension : .mainApplication
  )
  private static let network = NativeNetworkDiagnostics(journal: journal)

  public static func start() { network.start() }

  public static func observe<Result>(
    _ event: NativeDiagnosticEvent, trigger: NativeDiagnosticTrigger = .unspecified,
    _ operation: () throws -> Result
  ) rethrows -> Result {
    let observation = journal.begin(event, trigger: trigger)
    do {
      let result = try operation()
      journal.finish(observation, outcome: .succeeded)
      return result
    } catch {
      journal.finish(observation, outcome: .failed, failure: failure(error))
      throw error
    }
  }

  public static func failure(_ error: Error) -> NativeDiagnosticFailure {
    if let binding = error as? BindingError, case let .Engine(code, _, retryable) = binding {
      return .init(reason: .engineFailure, code: Int64(code), retryable: retryable)
    }
    if let failure = error as? ExtensionP2pError {
      switch failure {
      case .sharedStoreUnavailable: return .init(reason: .storageUnavailable)
      case .spaceUnavailable: return .init(reason: .spaceUnavailable)
      case .runtimeBusy: return .init(reason: .runtimeBusy)
      case .sessionClosed: return .init(reason: .cancelled)
      case .deliveryIncomplete: return .init(reason: .engineFailure)
      }
    }
    if (error as NSError).domain == NSOSStatusErrorDomain {
      return .init(reason: .nativeFailure, code: Int64((error as NSError).code))
    }
    return .init(reason: .nativeFailure)
  }

  public static func exportSnapshot() -> [String: Any] {
    let completed = journal.flush()
    let discovery = journal.fileDiscovery()
    return [
      "flushStatus": completed ? "completed" : "incomplete",
      "writer": journal.snapshot().dictionary,
      "fileUris": discovery.files.map(\.absoluteString),
      "discoveryStatus": discovery.status, "skippedFileCount": discovery.skippedFiles,
    ]
  }
}

private final class NativeNetworkDiagnostics: @unchecked Sendable {
  private let journal: NativeRuntimeDiagnostics
  private let monitor = NWPathMonitor()
  private let queue = DispatchQueue(label: "app.uniclipboard.native-network-diagnostics", qos: .utility)
  private let lock = NSLock()
  private var started = false
  private var hasObservedPath = false

  init(journal: NativeRuntimeDiagnostics) { self.journal = journal }

  func start() {
    let shouldStart = lock.withLock {
      if started { return false }
      started = true
      return true
    }
    guard shouldStart else { return }
    monitor.pathUpdateHandler = { [weak self] path in
      guard let self else { return }
      let available = path.status == .satisfied
      let kind: NativeDiagnosticNetwork.Kind = !available ? .none
        : path.usesInterfaceType(.wifi) ? .wifi
        : path.usesInterfaceType(.cellular) ? .cellular
        : path.usesInterfaceType(.wiredEthernet) ? .wired : .other
      let next = NativeDiagnosticNetwork(available: available, kind: kind,
        expensive: path.isExpensive, constrained: path.isConstrained,
        change: hasObservedPath ? .pathUpdate : .initial)
      hasObservedPath = true
      journal.record(.networkChanged, trigger: .networkChange, network: next)
    }
    monitor.start(queue: queue)
    journal.record(.networkObservation, trigger: .appStartup, outcome: .succeeded)
  }
}
