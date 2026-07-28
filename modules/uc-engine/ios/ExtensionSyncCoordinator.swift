import CryptoKit
import Foundation

public enum ExtensionSyncTrigger: Int, Equatable, Sendable {
  case appeared = 0
  case networkChanged = 1
  case localClipboardChanged = 2
  case serverChanged = 3
  case manual = 4

  public var shouldPublishHistoryImmediately: Bool {
    switch self {
    case .localClipboardChanged: return true
    default: return true
    }
  }

  public var showsSyncProgress: Bool {
    switch self {
    case .localClipboardChanged: return false
    case .serverChanged, .manual: return true
    case .appeared, .networkChanged: return false
    }
  }
}

public struct ExtensionSyncEventGate: Sendable {
  private var isRunning = false
  private var pending: ExtensionSyncTrigger?

  public init() {}

  public mutating func request(_ trigger: ExtensionSyncTrigger) -> ExtensionSyncTrigger? {
    guard isRunning else {
      isRunning = true
      return trigger
    }
    if pending.map({ trigger.rawValue > $0.rawValue }) ?? true {
      pending = trigger
    }
    return nil
  }

  public mutating func finish() -> ExtensionSyncTrigger? {
    guard isRunning else { return nil }
    guard let pending else {
      isRunning = false
      return nil
    }
    self.pending = nil
    return pending
  }

  public mutating func cancelAll() {
    isRunning = false
    pending = nil
  }
}

public struct ExtensionClipboardRevisionTracker: Sendable {
  private var lastHandledRevision: Int?
  private var processingRevision: Int?

  public init(lastHandledRevision: Int? = nil) {
    self.lastHandledRevision = lastHandledRevision
  }

  public func hasUnprocessedChange(_ revision: Int) -> Bool {
    revision != lastHandledRevision && revision != processingRevision
  }

  public mutating func markProcessing(_ revision: Int) {
    processingRevision = revision
  }

  public mutating func finishProcessing(_ revision: Int) {
    guard processingRevision == revision else { return }
    processingRevision = nil
  }

  public mutating func markSynchronizedWrite(_ revision: Int) {
    lastHandledRevision = revision
    finishProcessing(revision)
  }
}

public enum ExtensionStableIdentifier {
  public static func uuid(for value: String) -> UUID {
    let digest: String
    if value.hasPrefix("blake3v1:") {
      digest = String(value.dropFirst("blake3v1:".count))
    } else {
      digest = value
    }
    if let bytes = firstUUIDBytes(fromHex: digest) {
      return uuid(from: bytes)
    }
    return uuid(from: Array(SHA256.hash(data: Data(value.utf8)).prefix(16)))
  }

  private static func firstUUIDBytes(fromHex value: String) -> [UInt8]? {
    var bytes: [UInt8] = []
    bytes.reserveCapacity(16)
    var iterator = value.makeIterator()
    while bytes.count < 16, let high = iterator.next(), let low = iterator.next() {
      guard let highValue = high.hexDigitValue, let lowValue = low.hexDigitValue else {
        return nil
      }
      bytes.append(UInt8(highValue << 4 | lowValue))
    }
    return bytes.count == 16 ? bytes : nil
  }

  private static func uuid(from bytes: [UInt8]) -> UUID {
    UUID(
      uuid: (
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5], bytes[6], bytes[7],
        bytes[8], bytes[9], bytes[10], bytes[11],
        bytes[12], bytes[13], bytes[14], bytes[15]
      )
    )
  }
}

public enum ExtensionSyncEvent: Equatable, Sendable {
  case remoteActiveClipboardChanged(entryId: String)
  case other
}

public protocol ExtensionSyncEngine: AnyObject {
  func refreshPeerConnections() throws -> ExtensionPeerRefreshReport
  func queryCurrentRemoteClipboardEntryId() throws -> String?
  func nextEvent(timeoutMs: UInt64) throws -> ExtensionSyncEvent?
  func restoreRemoteClipboard(entryId: String) throws -> Bool
}

public struct ExtensionPeerRefreshReport: Equatable, Sendable {
  public let total: UInt64
  public let online: UInt64
  public let offline: UInt64
  public let errors: UInt64

  public init(total: UInt64, online: UInt64, offline: UInt64, errors: UInt64) {
    self.total = total
    self.online = online
    self.offline = offline
    self.errors = errors
  }
}

public enum ExtensionDeliveryState: Equatable, Sendable {
  case delivered
  case partial
  case offline
  case pending
  case failed
}

public struct ExtensionDeliveryReport: Equatable, Sendable {
  public let entryId: String
  public let accepted: UInt64
  public let duplicate: UInt64
  public let offline: UInt64
  public let errored: UInt64
  public let pending: UInt64

  public init(
    entryId: String,
    accepted: UInt64,
    duplicate: UInt64,
    offline: UInt64,
    errored: UInt64,
    pending: UInt64
  ) {
    self.entryId = entryId
    self.accepted = accepted
    self.duplicate = duplicate
    self.offline = offline
    self.errored = errored
    self.pending = pending
  }

  public var state: ExtensionDeliveryState {
    let delivered = accepted + duplicate
    let incomplete = offline + errored + pending
    if delivered > 0 {
      return incomplete > 0 ? .partial : .delivered
    }
    if errored > 0 { return .failed }
    if offline > 0 { return .offline }
    if pending > 0 { return .pending }
    return .failed
  }
}

public struct ExtensionSyncResult: Equatable, Sendable {
  public let receivedRemoteChange: Bool
  public let delivery: ExtensionDeliveryReport?
  public let peerRefresh: ExtensionPeerRefreshReport
}

public enum ExtensionSyncExecutor {
  public static func run<T: Sendable>(
    _ operation: @escaping @Sendable () throws -> T
  ) async throws -> T {
    try await Task.detached(priority: .userInitiated, operation: operation).value
  }
}

public final class ExtensionSyncCoordinator {
  private let engine: any ExtensionSyncEngine
  private var lastRestoredRemoteEntryId: String?

  public init(engine: any ExtensionSyncEngine) {
    self.engine = engine
  }

  public func synchronize(
    send: (() throws -> ExtensionDeliveryReport)?,
    receiveTimeoutMs: UInt64
  ) throws -> ExtensionSyncResult {
    let delivery: ExtensionDeliveryReport?
    let peerRefresh: ExtensionPeerRefreshReport
    if let send {
      let initialDelivery = try send()
      if initialDelivery.state == .offline {
        peerRefresh = try engine.refreshPeerConnections()
        delivery = peerRefresh.online > 0 ? try send() : initialDelivery
      } else {
        delivery = initialDelivery
        peerRefresh = initialDelivery.peerRefreshSummary
      }
    } else {
      peerRefresh = try engine.refreshPeerConnections()
      delivery = nil
    }
    var pendingRemoteEntryId = try engine.queryCurrentRemoteClipboardEntryId()
    if try restoreRemoteClipboardIfNeeded(entryId: pendingRemoteEntryId) {
      return ExtensionSyncResult(
        receivedRemoteChange: true,
        delivery: delivery,
        peerRefresh: peerRefresh
      )
    }
    guard receiveTimeoutMs > 0 else {
      return ExtensionSyncResult(
        receivedRemoteChange: false,
        delivery: delivery,
        peerRefresh: peerRefresh
      )
    }

    let start = DispatchTime.now().uptimeNanoseconds
    let timeoutNanoseconds = receiveTimeoutMs.multipliedReportingOverflow(by: 1_000_000)
    let budget = timeoutNanoseconds.overflow ? UInt64.max : timeoutNanoseconds.partialValue
    while true {
      let elapsed = DispatchTime.now().uptimeNanoseconds - start
      guard elapsed < budget else {
        let restored = try restoreRemoteClipboardIfNeeded(entryId: pendingRemoteEntryId)
        return ExtensionSyncResult(
          receivedRemoteChange: restored,
          delivery: delivery,
          peerRefresh: peerRefresh
        )
      }
      let remainingNanoseconds = budget - elapsed
      let wholeMilliseconds = remainingNanoseconds / 1_000_000
      let remainingMs = wholeMilliseconds + (remainingNanoseconds % 1_000_000 == 0 ? 0 : 1)
      guard let event = try engine.nextEvent(timeoutMs: remainingMs) else {
        let restored = try restoreRemoteClipboardIfNeeded(entryId: pendingRemoteEntryId)
        return ExtensionSyncResult(
          receivedRemoteChange: restored,
          delivery: delivery,
          peerRefresh: peerRefresh
        )
      }
      if case .remoteActiveClipboardChanged(let entryId) = event {
        pendingRemoteEntryId = entryId
      }
      if try restoreRemoteClipboardIfNeeded(entryId: pendingRemoteEntryId) {
        return ExtensionSyncResult(
          receivedRemoteChange: true,
          delivery: delivery,
          peerRefresh: peerRefresh
        )
      }
    }
  }

  public func waitForRemoteChange(timeoutMs: UInt64) throws -> Bool {
    guard timeoutMs > 0 else { return false }
    let start = DispatchTime.now().uptimeNanoseconds
    let timeoutNanoseconds = timeoutMs.multipliedReportingOverflow(by: 1_000_000)
    let budget = timeoutNanoseconds.overflow ? UInt64.max : timeoutNanoseconds.partialValue
    var pendingRemoteEntryId: String?

    while true {
      let elapsed = DispatchTime.now().uptimeNanoseconds - start
      guard elapsed < budget else {
        return try restoreRemoteClipboardIfNeeded(entryId: pendingRemoteEntryId)
      }
      let remainingNanoseconds = budget - elapsed
      let wholeMilliseconds = remainingNanoseconds / 1_000_000
      let remainingMs = wholeMilliseconds + (remainingNanoseconds % 1_000_000 == 0 ? 0 : 1)
      guard let event = try engine.nextEvent(timeoutMs: remainingMs) else {
        return try restoreRemoteClipboardIfNeeded(entryId: pendingRemoteEntryId)
      }
      if case .remoteActiveClipboardChanged(let entryId) = event {
        pendingRemoteEntryId = entryId
      }
      if try restoreRemoteClipboardIfNeeded(entryId: pendingRemoteEntryId) {
        return true
      }
    }
  }

  private func restoreRemoteClipboardIfNeeded(entryId: String?) throws -> Bool {
    guard let entryId, entryId != lastRestoredRemoteEntryId else { return false }
    guard try engine.restoreRemoteClipboard(entryId: entryId) else { return false }
    lastRestoredRemoteEntryId = entryId
    return true
  }
}

extension ExtensionDeliveryReport {
  fileprivate var peerRefreshSummary: ExtensionPeerRefreshReport {
    let total = accepted + duplicate + offline + errored + pending
    return ExtensionPeerRefreshReport(
      total: total,
      online: total - offline,
      offline: offline,
      errors: errored
    )
  }
}
