import Foundation

public enum ShareDiagnosticChannel: String, Codable, Equatable, Sendable {
  case p2p
  case lan
}

public enum ShareDiagnosticItemKind: String, Codable, Equatable, Sendable {
  case text
  case image
  case file
}

public enum ShareDiagnosticStage: String, Codable, Equatable, Sendable {
  case attemptStarted = "attempt_started"
  case handoffStarted = "handoff_started"
  case handoffQueued = "handoff_queued"
  case networkObserved = "network_observed"
  case routePrepared = "route_prepared"
  case engineStarting = "engine_starting"
  case engineReady = "engine_ready"
  case connecting
  case peerRefresh = "peer_refresh"
  case connected
  case sending
  case deliveryAccepted = "delivery_accepted"
  case deliveryWaiting = "delivery_waiting"
  case sent
  case failed
}

public enum ShareDiagnosticErrorCode: String, Codable, Equatable, Sendable {
  case receiverOffline = "receiver_offline"
  case sharedStoreUnavailable = "shared_store_unavailable"
  case spaceUnavailable = "space_unavailable"
  case runtimeBusy = "runtime_busy"
  case sessionClosed = "session_closed"
  case deliveryPartial = "delivery_partial"
  case deliveryOffline = "delivery_offline"
  case deliveryPending = "delivery_pending"
  case deliveryFailed = "delivery_failed"
  case deliveryTimedOut = "delivery_timed_out"
  case deliveryDownloadFailed = "delivery_download_failed"
  case deliveryCancelled = "delivery_cancelled"
  case engine
  case hostUnavailable = "host_unavailable"
  case hostPermissionDenied = "host_permission_denied"
  case hostInvalidHandle = "host_invalid_handle"
  case hostIO = "host_io"
  case runtimeUnavailable = "runtime_unavailable"
  case alreadyStopped = "already_stopped"
  case unexpectedEngineResult = "unexpected_engine_result"
  case authentication
  case connectTimeout = "connect_timeout"
  case receiveTimeout = "receive_timeout"
  case networkUnreachable = "network_unreachable"
  case invalidURL = "invalid_url"
  case protocolError = "protocol_error"
  case serverError = "server_error"
  case notFound = "not_found"
  case hashMismatch = "hash_mismatch"
  case cancelled
  case handoffFailed = "handoff_failed"
  case unknown
}

public enum ShareDiagnosticEngineCategory: String, Codable, Equatable, Sendable {
  case invalidInput = "invalid_input"
  case invalidState = "invalid_state"
  case unauthorized
  case notFound = "not_found"
  case conflict
  case unavailable
  case deadlineExceeded = "deadline_exceeded"
  case `internal`
}

public struct ShareDiagnosticNetwork: Codable, Equatable, Sendable {
  public let wifi: Bool
  public let cellular: Bool
  public let tailscale: Bool

  public init(wifi: Bool, cellular: Bool, tailscale: Bool) {
    self.wifi = wifi
    self.cellular = cellular
    self.tailscale = tailscale
  }
}

public struct ShareDiagnosticRoute: Codable, Equatable, Sendable {
  public let candidateCount: Int
  public let hadRememberedLiveRoute: Bool

  public init(candidateCount: Int, hadRememberedLiveRoute: Bool) {
    self.candidateCount = candidateCount
    self.hadRememberedLiveRoute = hadRememberedLiveRoute
  }
}

public struct ShareDiagnosticPeerRefresh: Codable, Equatable, Sendable {
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

public struct ShareDiagnosticDelivery: Codable, Equatable, Sendable {
  public let accepted: UInt64
  public let duplicate: UInt64
  public let offline: UInt64
  public let errored: UInt64
  public let pending: UInt64

  public init(
    accepted: UInt64,
    duplicate: UInt64,
    offline: UInt64,
    errored: UInt64,
    pending: UInt64
  ) {
    self.accepted = accepted
    self.duplicate = duplicate
    self.offline = offline
    self.errored = errored
    self.pending = pending
  }
}

public struct ShareDiagnosticError: Codable, Equatable, Sendable {
  public let code: ShareDiagnosticErrorCode
  public let engineCode: UInt32?
  public let engineCategory: ShareDiagnosticEngineCategory?
  public let retryable: Bool?

  public init(
    code: ShareDiagnosticErrorCode,
    engineCode: UInt32? = nil,
    engineCategory: ShareDiagnosticEngineCategory? = nil,
    retryable: Bool? = nil
  ) {
    self.code = code
    self.engineCode = engineCode
    self.engineCategory = engineCategory
    self.retryable = retryable
  }
}

public struct ShareDiagnosticEvent: Codable, Equatable, Sendable {
  public let timestampMs: Int64
  public let elapsedMs: Int64
  public let stage: ShareDiagnosticStage
  public let network: ShareDiagnosticNetwork?
  public let route: ShareDiagnosticRoute?
  public let peerRefresh: ShareDiagnosticPeerRefresh?
  public let delivery: ShareDiagnosticDelivery?
  public let error: ShareDiagnosticError?
}

public struct ShareDiagnosticAttempt: Codable, Equatable, Sendable {
  public let id: String
  public let startedAtMs: Int64
  public let channel: ShareDiagnosticChannel
  public let itemKind: ShareDiagnosticItemKind
  public let byteCount: Int
  public fileprivate(set) var events: [ShareDiagnosticEvent]
}

public struct ShareDiagnosticsArchive: Codable, Equatable, Sendable {
  public let schemaVersion: Int
  public let attempts: [ShareDiagnosticAttempt]
}

public enum ShareDiagnosticsStoreError: Error {
  case invalidAttemptID
}

public final class ShareDiagnosticsStore: @unchecked Sendable {
  private let directoryURL: URL
  private let maxAttempts: Int
  private let retentionMilliseconds: Int64
  private let decoder = JSONDecoder()
  private let encoder = JSONEncoder()

  public init(
    containerURL: URL,
    maxAttempts: Int = 50,
    retentionMilliseconds: Int64 = 3 * 24 * 60 * 60 * 1_000
  ) throws {
    self.directoryURL = containerURL
      .appendingPathComponent("Library/Caches/UniClipDiagnostics", isDirectory: true)
      .appendingPathComponent("share-attempts", isDirectory: true)
    self.maxAttempts = max(1, maxAttempts)
    self.retentionMilliseconds = max(0, retentionMilliseconds)
    try FileManager.default.createDirectory(
      at: directoryURL,
      withIntermediateDirectories: true
    )
  }

  public func startAttempt(
    id: String = UUID().uuidString.lowercased(),
    channel: ShareDiagnosticChannel,
    itemKind: ShareDiagnosticItemKind,
    byteCount: Int,
    startedAtMs: Int64 = Int64(Date().timeIntervalSince1970 * 1_000)
  ) throws -> ShareDiagnosticRecorder {
    guard Self.isValidAttemptID(id) else {
      throw ShareDiagnosticsStoreError.invalidAttemptID
    }
    let attempt = ShareDiagnosticAttempt(
      id: id,
      startedAtMs: startedAtMs,
      channel: channel,
      itemKind: itemKind,
      byteCount: max(0, byteCount),
      events: []
    )
    try persist(attempt)
    prune(nowMs: startedAtMs)
    return ShareDiagnosticRecorder(store: self, attempt: attempt)
  }

  public func loadArchive(
    nowMs: Int64 = Int64(Date().timeIntervalSince1970 * 1_000)
  ) -> ShareDiagnosticsArchive {
    let loaded = loadAttempts()
    let cutoff = nowMs - retentionMilliseconds
    let retained = loaded
      .filter { $0.attempt.startedAtMs >= cutoff }
      .sorted {
        if $0.attempt.startedAtMs == $1.attempt.startedAtMs {
          return $0.attempt.id > $1.attempt.id
        }
        return $0.attempt.startedAtMs > $1.attempt.startedAtMs
      }
    let kept = Array(retained.prefix(maxAttempts))
    let keptURLs = Set(kept.map(\.url))
    for candidate in loaded where !keptURLs.contains(candidate.url) {
      try? FileManager.default.removeItem(at: candidate.url)
    }
    return ShareDiagnosticsArchive(schemaVersion: 1, attempts: kept.map(\.attempt))
  }

  fileprivate func persist(_ attempt: ShareDiagnosticAttempt) throws {
    let data = try encoder.encode(attempt)
    try data.write(to: fileURL(for: attempt.id), options: .atomic)
  }

  private func prune(nowMs: Int64) {
    _ = loadArchive(nowMs: nowMs)
  }

  private func loadAttempts() -> [(url: URL, attempt: ShareDiagnosticAttempt)] {
    let urls = (try? FileManager.default.contentsOfDirectory(
      at: directoryURL,
      includingPropertiesForKeys: nil
    )) ?? []
    return urls.compactMap { url in
      guard url.pathExtension == "json",
            let data = try? Data(contentsOf: url),
            let attempt = try? decoder.decode(ShareDiagnosticAttempt.self, from: data)
      else {
        if url.pathExtension == "json" {
          try? FileManager.default.removeItem(at: url)
        }
        return nil
      }
      return (url, attempt)
    }
  }

  private func fileURL(for attemptID: String) -> URL {
    directoryURL.appendingPathComponent("\(attemptID).json", isDirectory: false)
  }

  private static func isValidAttemptID(_ value: String) -> Bool {
    !value.isEmpty
      && value.range(of: #"^[A-Za-z0-9-]+$"#, options: .regularExpression) != nil
  }
}

public final class ShareDiagnosticRecorder: @unchecked Sendable {
  public let attemptID: String

  private let store: ShareDiagnosticsStore
  private let lock = NSLock()
  private var attempt: ShareDiagnosticAttempt

  fileprivate init(store: ShareDiagnosticsStore, attempt: ShareDiagnosticAttempt) {
    self.store = store
    self.attempt = attempt
    self.attemptID = attempt.id
  }

  public func record(
    stage: ShareDiagnosticStage,
    network: ShareDiagnosticNetwork? = nil,
    route: ShareDiagnosticRoute? = nil,
    peerRefresh: ShareDiagnosticPeerRefresh? = nil,
    delivery: ShareDiagnosticDelivery? = nil,
    error: ShareDiagnosticError? = nil,
    timestampMs: Int64 = Int64(Date().timeIntervalSince1970 * 1_000)
  ) {
    lock.withLock {
      attempt.events.append(ShareDiagnosticEvent(
        timestampMs: timestampMs,
        elapsedMs: max(0, timestampMs - attempt.startedAtMs),
        stage: stage,
        network: network,
        route: route,
        peerRefresh: peerRefresh,
        delivery: delivery,
        error: error
      ))
      try? store.persist(attempt)
    }
  }
}
