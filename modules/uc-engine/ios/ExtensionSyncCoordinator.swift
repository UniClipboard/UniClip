import CryptoKit
import Foundation

public enum ExtensionSyncTrigger: Int, Equatable, Sendable {
  case appeared = 0
  case localClipboardChanged = 1
  case manual = 2

  public var shouldPublishHistoryImmediately: Bool {
    switch self {
    case .localClipboardChanged: return true
    default: return true
    }
  }

  public var showsSyncProgress: Bool {
    switch self {
    case .localClipboardChanged: return false
    case .manual: return true
    case .appeared: return false
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
  case outboundTransferProgress(
    entryId: String,
    peerId: String,
    completedBytes: UInt64,
    totalBytes: UInt64?
  )
  case outboundTransferStatusChanged(
    entryId: String,
    peerId: String?,
    status: String,
    reason: String?
  )
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

public enum ExtensionSendProgress: Int, Equatable, Sendable {
  case connecting
  case connected
  case sending
  case sent
}

public struct ExtensionTransferProgress: Equatable, Sendable {
  public let peerId: String
  public let completedBytes: UInt64
  public let totalBytes: UInt64?

  public init(peerId: String, completedBytes: UInt64, totalBytes: UInt64?) {
    self.peerId = peerId
    self.completedBytes = completedBytes
    self.totalBytes = totalBytes
  }
}

public enum ExtensionPeerConnectionError: Error, Equatable, LocalizedError, Sendable {
  case noOnlinePeer
  case connectionTimedOut

  public var errorDescription: String? {
    switch self {
    case .noOnlinePeer:
      return "No receiving device is configured."
    case .connectionTimedOut:
      return "The connection could not be restored in time."
    }
  }
}

public struct ExtensionPeerConnectionPolicy: Equatable, Sendable {
  public let maxAttempts: Int
  public let retryDelayMs: UInt64

  public init(maxAttempts: Int = 3, retryDelayMs: UInt64 = 250) {
    self.maxAttempts = max(1, maxAttempts)
    self.retryDelayMs = retryDelayMs
  }
}

public enum ExtensionOutboundDeliveryPolicy {
  public static let maxInlineImageBytes = 64 * 1024

  public static func requiresRemoteDownloadForImage(byteCount: Int) -> Bool {
    byteCount > maxInlineImageBytes
  }
}

public enum ExtensionOutboundDeliveryError: Error, Equatable, LocalizedError, Sendable {
  case timedOut
  case failed(reason: String?)
  case cancelled(reason: String?)

  public var errorDescription: String? {
    switch self {
    case .timedOut:
      return "The receiving device did not finish downloading in time."
    case .failed:
      return "The receiving device could not download this content."
    case .cancelled:
      return "The receiving device cancelled the download."
    }
  }
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
  private let peerConnectionPolicy: ExtensionPeerConnectionPolicy
  private var lastRestoredRemoteEntryId: String?

  public init(
    engine: any ExtensionSyncEngine,
    peerConnectionPolicy: ExtensionPeerConnectionPolicy = ExtensionPeerConnectionPolicy()
  ) {
    self.engine = engine
    self.peerConnectionPolicy = peerConnectionPolicy
  }

  public func synchronize(
    send: (() throws -> ExtensionDeliveryReport)?,
    receiveTimeoutMs: UInt64,
    progress: ((ExtensionSendProgress) -> Void)? = nil,
    onPeerRefresh: ((ExtensionPeerRefreshReport) -> Void)? = nil
  ) throws -> ExtensionSyncResult {
    let delivery: ExtensionDeliveryReport?
    let peerRefresh: ExtensionPeerRefreshReport
    if let send {
      progress?(.connecting)
      peerRefresh = try refreshPeersForSend(onPeerRefresh: onPeerRefresh)
      progress?(.connected)
      progress?(.sending)
      delivery = try send()
    } else {
      peerRefresh = try engine.refreshPeerConnections()
      onPeerRefresh?(peerRefresh)
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

  public func waitForOutboundDelivery(
    entryId: String,
    expectedReceiverCount: UInt64,
    timeoutMs: UInt64,
    onTransferProgress: ((ExtensionTransferProgress) -> Void)? = nil
  ) throws {
    guard expectedReceiverCount > 0 else { return }
    guard timeoutMs > 0 else { throw ExtensionOutboundDeliveryError.timedOut }

    let start = DispatchTime.now().uptimeNanoseconds
    let timeoutNanoseconds = timeoutMs.multipliedReportingOverflow(by: 1_000_000)
    let budget = timeoutNanoseconds.overflow ? UInt64.max : timeoutNanoseconds.partialValue
    var completedPeers = Set<String>()

    while true {
      let elapsed = DispatchTime.now().uptimeNanoseconds - start
      guard elapsed < budget else { throw ExtensionOutboundDeliveryError.timedOut }
      let remainingNanoseconds = budget - elapsed
      let wholeMilliseconds = remainingNanoseconds / 1_000_000
      let remainingMs = wholeMilliseconds + (remainingNanoseconds % 1_000_000 == 0 ? 0 : 1)
      guard let event = try engine.nextEvent(timeoutMs: remainingMs) else {
        throw ExtensionOutboundDeliveryError.timedOut
      }
      if case .outboundTransferProgress(
        let eventEntryId,
        let peerId,
        let completedBytes,
        let totalBytes
      ) = event, eventEntryId == entryId {
        onTransferProgress?(ExtensionTransferProgress(
          peerId: peerId,
          completedBytes: completedBytes,
          totalBytes: totalBytes
        ))
        continue
      }
      guard
        case .outboundTransferStatusChanged(
          let eventEntryId,
          let peerId,
          let status,
          let reason
        ) = event,
        eventEntryId == entryId
      else { continue }

      switch status.lowercased() {
      case "completed":
        guard let peerId else { continue }
        completedPeers.insert(peerId)
        if UInt64(completedPeers.count) >= expectedReceiverCount {
          return
        }
      case "failed":
        throw ExtensionOutboundDeliveryError.failed(reason: reason)
      case "cancelled":
        throw ExtensionOutboundDeliveryError.cancelled(reason: reason)
      default:
        continue
      }
    }
  }

  private func restoreRemoteClipboardIfNeeded(entryId: String?) throws -> Bool {
    guard let entryId, entryId != lastRestoredRemoteEntryId else { return false }
    guard try engine.restoreRemoteClipboard(entryId: entryId) else { return false }
    lastRestoredRemoteEntryId = entryId
    return true
  }

  private func refreshPeersForSend(
    onPeerRefresh: ((ExtensionPeerRefreshReport) -> Void)?
  ) throws -> ExtensionPeerRefreshReport {
    for attempt in 1...peerConnectionPolicy.maxAttempts {
      let report = try engine.refreshPeerConnections()
      onPeerRefresh?(report)
      if report.online > 0 {
        return report
      }
      if report.total == 0 && report.errors == 0 {
        throw ExtensionPeerConnectionError.noOnlinePeer
      }
      guard attempt < peerConnectionPolicy.maxAttempts else {
        throw ExtensionPeerConnectionError.connectionTimedOut
      }
      if peerConnectionPolicy.retryDelayMs > 0 {
        Thread.sleep(
          forTimeInterval: Double(peerConnectionPolicy.retryDelayMs) / 1_000
        )
      }
    }
    throw ExtensionPeerConnectionError.connectionTimedOut
  }
}
