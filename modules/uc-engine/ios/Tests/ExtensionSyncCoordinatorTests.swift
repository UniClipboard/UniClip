import XCTest

@testable import UcEngineSystemHost

final class ExtensionSyncCoordinatorTests: XCTestCase {
  func testSyncGateCoalescesEventsWhileOneRunIsActive() {
    var gate = ExtensionSyncEventGate()

    XCTAssertEqual(gate.request(.appeared), .appeared)
    XCTAssertNil(gate.request(.networkChanged))
    XCTAssertNil(gate.request(.localClipboardChanged))

    XCTAssertEqual(gate.finish(), .localClipboardChanged)
    XCTAssertNil(gate.finish())
    XCTAssertEqual(gate.request(.appeared), .appeared)
  }

  func testSyncGateKeepsTheHighestPriorityPendingEvent() {
    var gate = ExtensionSyncEventGate()

    XCTAssertEqual(gate.request(.appeared), .appeared)
    XCTAssertNil(gate.request(.networkChanged))
    XCTAssertNil(gate.request(.serverChanged))
    XCTAssertNil(gate.request(.manual))
    XCTAssertNil(gate.request(.localClipboardChanged))

    XCTAssertEqual(gate.finish(), .manual)
  }

  func testSyncGateResetsWhenKeyboardDisappearsDuringAnActiveRun() {
    var gate = ExtensionSyncEventGate()

    XCTAssertEqual(gate.request(.appeared), .appeared)
    XCTAssertNil(gate.request(.manual))

    gate.cancelAll()

    XCTAssertEqual(gate.request(.appeared), .appeared)
  }

  func testAutomaticLocalClipboardSyncPublishesTheCardWithoutShowingProgress() {
    XCTAssertFalse(ExtensionSyncTrigger.appeared.showsSyncProgress)
    XCTAssertFalse(ExtensionSyncTrigger.networkChanged.showsSyncProgress)
    XCTAssertTrue(ExtensionSyncTrigger.localClipboardChanged.shouldPublishHistoryImmediately)
    XCTAssertFalse(ExtensionSyncTrigger.localClipboardChanged.showsSyncProgress)

    XCTAssertTrue(ExtensionSyncTrigger.serverChanged.showsSyncProgress)
    XCTAssertTrue(ExtensionSyncTrigger.manual.shouldPublishHistoryImmediately)
    XCTAssertTrue(ExtensionSyncTrigger.manual.showsSyncProgress)
  }

  func testSynchronizedClipboardWriteDoesNotTriggerAnotherSync() {
    var tracker = ExtensionClipboardRevisionTracker(lastHandledRevision: 10)

    XCTAssertFalse(tracker.hasUnprocessedChange(10))
    XCTAssertTrue(tracker.hasUnprocessedChange(11))

    tracker.markSynchronizedWrite(11)

    XCTAssertFalse(tracker.hasUnprocessedChange(11))
  }

  func testUserCopyAfterSynchronizedWriteRemainsPending() {
    var tracker = ExtensionClipboardRevisionTracker(lastHandledRevision: 20)
    tracker.markSynchronizedWrite(21)

    XCTAssertTrue(tracker.hasUnprocessedChange(22))
  }

  func testClipboardRevisionBeingProcessedIsNotQueuedAgain() {
    var tracker = ExtensionClipboardRevisionTracker(lastHandledRevision: 10)

    tracker.markProcessing(11)

    XCTAssertFalse(tracker.hasUnprocessedChange(11))
    XCTAssertTrue(tracker.hasUnprocessedChange(12))

    tracker.finishProcessing(11)

    XCTAssertTrue(tracker.hasUnprocessedChange(11))
  }

  func testStableIdentifierSupportsVersionedContentHashes() {
    let digest = String(repeating: "0123456789abcdef", count: 4)
    let versioned = "blake3v1:\(digest)"

    XCTAssertEqual(
      ExtensionStableIdentifier.uuid(for: versioned),
      ExtensionStableIdentifier.uuid(for: versioned)
    )
    XCTAssertEqual(
      ExtensionStableIdentifier.uuid(for: versioned),
      ExtensionStableIdentifier.uuid(for: digest)
    )
  }

  func testStableIdentifierHasDeterministicFallbackForOtherValues() {
    XCTAssertEqual(
      ExtensionStableIdentifier.uuid(for: "future-hash-format:value"),
      ExtensionStableIdentifier.uuid(for: "future-hash-format:value")
    )
  }

  @MainActor
  func testBlockingExtensionWorkDoesNotBlockMainActor() async throws {
    let clock = ContinuousClock()
    let startedAt = clock.now
    let work = Task {
      try await ExtensionSyncExecutor.run {
        Thread.sleep(forTimeInterval: 0.2)
        return 42
      }
    }

    try await Task.sleep(for: .milliseconds(25))

    XCTAssertLessThan(startedAt.duration(to: clock.now), .milliseconds(100))
    let result = try await work.value
    XCTAssertEqual(result, 42)
  }

  func testReceiveRunsWithoutPendingOutboundClipboard() throws {
    let engine = FakeExtensionSyncEngine(
      events: [.other, .remoteActiveClipboardChanged(entryId: "remote-entry")],
      restoreResults: [true]
    )
    let coordinator = ExtensionSyncCoordinator(engine: engine)

    let result = try coordinator.synchronize(send: nil, receiveTimeoutMs: 1_000)

    XCTAssertEqual(engine.refreshCalls, 1)
    XCTAssertEqual(engine.eventTimeouts.count, 2)
    XCTAssertEqual(engine.restoredEntryIds, ["remote-entry"])
    XCTAssertTrue(result.receivedRemoteChange)
    XCTAssertNil(result.delivery)
    XCTAssertEqual(result.peerRefresh, engine.refreshReport)
  }

  func testReceiveRestoresCurrentRemoteClipboardWhenActivationPredatesListener() throws {
    let engine = FakeExtensionSyncEngine(
      events: [],
      currentRemoteEntryId: "remote-before-listener",
      restoreResults: [true]
    )
    let coordinator = ExtensionSyncCoordinator(engine: engine)

    let result = try coordinator.synchronize(send: nil, receiveTimeoutMs: 1_000)

    XCTAssertEqual(engine.currentRemoteEntryQueries, 1)
    XCTAssertEqual(engine.restoredEntryIds, ["remote-before-listener"])
    XCTAssertTrue(result.receivedRemoteChange)
  }

  func testReceiveWaitsForRemotePayloadBeforeReportingChange() throws {
    let engine = FakeExtensionSyncEngine(
      events: [.remoteActiveClipboardChanged(entryId: "remote-image"), .other],
      restoreResults: [false, true]
    )
    let coordinator = ExtensionSyncCoordinator(engine: engine)

    let result = try coordinator.synchronize(send: nil, receiveTimeoutMs: 1_000)

    XCTAssertEqual(engine.restoredEntryIds, ["remote-image", "remote-image"])
    XCTAssertTrue(result.receivedRemoteChange)
  }

  func testReceiveDoesNotReportChangeWhenRemotePayloadCannotBeRestored() throws {
    let engine = FakeExtensionSyncEngine(
      events: [.remoteActiveClipboardChanged(entryId: "missing-payload")],
      restoreResults: [false, false]
    )
    let coordinator = ExtensionSyncCoordinator(engine: engine)

    let result = try coordinator.synchronize(send: nil, receiveTimeoutMs: 1_000)

    XCTAssertEqual(engine.restoredEntryIds, ["missing-payload", "missing-payload"])
    XCTAssertFalse(result.receivedRemoteChange)
  }

  func testReceiveTimeoutIsAStableNoChangeResult() throws {
    let engine = FakeExtensionSyncEngine(events: [])
    let coordinator = ExtensionSyncCoordinator(engine: engine)

    let result = try coordinator.synchronize(send: nil, receiveTimeoutMs: 1_000)

    XCTAssertFalse(result.receivedRemoteChange)
    XCTAssertEqual(engine.eventTimeouts, [1_000])
  }

  func testContinuedReceiveDoesNotRefreshOrReplayTheCurrentRemoteClipboard() throws {
    let engine = FakeExtensionSyncEngine(
      events: [],
      currentRemoteEntryId: "remote-current",
      restoreResults: [true]
    )
    let coordinator = ExtensionSyncCoordinator(engine: engine)

    let initial = try coordinator.synchronize(send: nil, receiveTimeoutMs: 0)
    let continued = try coordinator.waitForRemoteChange(timeoutMs: 1_000)

    XCTAssertTrue(initial.receivedRemoteChange)
    XCTAssertFalse(continued)
    XCTAssertEqual(engine.refreshCalls, 1)
    XCTAssertEqual(engine.currentRemoteEntryQueries, 1)
    XCTAssertEqual(engine.restoredEntryIds, ["remote-current"])
    XCTAssertEqual(engine.eventTimeouts, [1_000])
  }

}

extension ExtensionSyncCoordinatorTests {
  func testDeliveryReportPreservesAllTargetOutcomes() throws {
    let engine = FakeExtensionSyncEngine(events: [])
    let report = ExtensionDeliveryReport(
      entryId: "entry-1",
      accepted: 1,
      duplicate: 0,
      offline: 1,
      errored: 0,
      pending: 0
    )
    let coordinator = ExtensionSyncCoordinator(engine: engine)

    let result = try coordinator.synchronize(send: { report }, receiveTimeoutMs: 0)

    XCTAssertEqual(result.delivery, report)
    XCTAssertEqual(result.delivery?.state, .partial)
  }

  func testSendConfirmsConnectionBeforeReportingTransmission() throws {
    let engine = FakeExtensionSyncEngine(events: [])
    let coordinator = ExtensionSyncCoordinator(engine: engine)
    var sendCalls = 0
    var progress: [ExtensionSendProgress] = []
    var observedRefreshes: [ExtensionPeerRefreshReport] = []

    let result = try coordinator.synchronize(
      send: {
        sendCalls += 1
        return self.report(accepted: 1)
      },
      receiveTimeoutMs: 0,
      progress: { progress.append($0) },
      onPeerRefresh: { observedRefreshes.append($0) }
    )

    XCTAssertEqual(sendCalls, 1)
    XCTAssertEqual(engine.refreshCalls, 1)
    XCTAssertEqual(progress, [.connecting, .connected, .sending])
    XCTAssertEqual(observedRefreshes, [engine.refreshReport])
    XCTAssertEqual(result.delivery?.state, .delivered)
    XCTAssertEqual(result.peerRefresh, engine.refreshReport)
  }

  func testSendDoesNotBeginWhenConnectionRefreshBudgetExpires() throws {
    let refresh = ExtensionPeerRefreshReport(total: 1, online: 0, offline: 1, errors: 0)
    let engine = FakeExtensionSyncEngine(events: [], refreshReport: refresh)
    let coordinator = ExtensionSyncCoordinator(engine: engine)
    var sendCalls = 0
    var progress: [ExtensionSendProgress] = []

    XCTAssertThrowsError(
      try coordinator.synchronize(
        send: {
          sendCalls += 1
          return self.report(accepted: 1)
        },
        receiveTimeoutMs: 0,
        progress: { progress.append($0) }
      )
    )

    XCTAssertEqual(sendCalls, 0)
    XCTAssertEqual(engine.refreshCalls, 3)
    XCTAssertEqual(progress, [.connecting])
  }

  func testSendKeepsConnectingUntilAReceiverComesOnline() throws {
    let offline = ExtensionPeerRefreshReport(total: 1, online: 0, offline: 1, errors: 0)
    let online = ExtensionPeerRefreshReport(total: 1, online: 1, offline: 0, errors: 0)
    let engine = FakeExtensionSyncEngine(
      events: [],
      refreshReports: [offline, offline, online]
    )
    let coordinator = ExtensionSyncCoordinator(
      engine: engine,
      peerConnectionPolicy: ExtensionPeerConnectionPolicy(
        maxAttempts: 3,
        retryDelayMs: 0
      )
    )
    var progress: [ExtensionSendProgress] = []
    var observedRefreshes: [ExtensionPeerRefreshReport] = []

    let result = try coordinator.synchronize(
      send: { self.report(accepted: 1) },
      receiveTimeoutMs: 0,
      progress: { progress.append($0) },
      onPeerRefresh: { observedRefreshes.append($0) }
    )

    XCTAssertEqual(engine.refreshCalls, 3)
    XCTAssertEqual(observedRefreshes, [offline, offline, online])
    XCTAssertEqual(progress, [.connecting, .connected, .sending])
    XCTAssertEqual(result.delivery?.state, .delivered)
  }

  func testSendTimesOutOnlyAfterTheConnectionAttemptBudgetIsExhausted() {
    let offline = ExtensionPeerRefreshReport(total: 1, online: 0, offline: 1, errors: 0)
    let engine = FakeExtensionSyncEngine(
      events: [],
      refreshReports: [offline, offline, offline]
    )
    let coordinator = ExtensionSyncCoordinator(
      engine: engine,
      peerConnectionPolicy: ExtensionPeerConnectionPolicy(
        maxAttempts: 3,
        retryDelayMs: 0
      )
    )
    var sendCalls = 0
    var progress: [ExtensionSendProgress] = []

    XCTAssertThrowsError(
      try coordinator.synchronize(
        send: {
          sendCalls += 1
          return self.report(accepted: 1)
        },
        receiveTimeoutMs: 0,
        progress: { progress.append($0) }
      )
    ) { error in
      XCTAssertEqual(error as? ExtensionPeerConnectionError, .connectionTimedOut)
    }

    XCTAssertEqual(engine.refreshCalls, 3)
    XCTAssertEqual(sendCalls, 0)
    XCTAssertEqual(progress, [.connecting])
  }

  func testDeliveryStateDoesNotTreatOfflineOrPendingAsSuccess() {
    XCTAssertEqual(report(accepted: 1).state, .delivered)
    XCTAssertEqual(report(duplicate: 1).state, .delivered)
    XCTAssertEqual(report(offline: 1).state, .offline)
    XCTAssertEqual(report(pending: 1).state, .pending)
    XCTAssertEqual(report(errored: 1).state, .failed)
    XCTAssertEqual(report().state, .failed)
  }

  func testOutboundDeliveryWaitsForEveryAcceptedPeer() throws {
    let engine = FakeExtensionSyncEngine(events: [
      .outboundTransferProgress(
        entryId: "shared-entry",
        peerId: "peer-1",
        completedBytes: 64,
        totalBytes: 128
      ),
      .outboundTransferStatusChanged(
        entryId: "shared-entry",
        peerId: "peer-1",
        status: "completed",
        reason: nil
      ),
      .outboundTransferProgress(
        entryId: "shared-entry",
        peerId: "peer-2",
        completedBytes: 128,
        totalBytes: 128
      ),
      .outboundTransferStatusChanged(
        entryId: "shared-entry",
        peerId: "peer-2",
        status: "completed",
        reason: nil
      ),
    ])
    let coordinator = ExtensionSyncCoordinator(engine: engine)

    try coordinator.waitForOutboundDelivery(
      entryId: "shared-entry",
      expectedReceiverCount: 2,
      timeoutMs: 1_000
    )

    XCTAssertEqual(engine.eventTimeouts.count, 4)
    XCTAssertEqual(engine.remainingEventCount, 0)
  }

  func testOutboundDeliveryReportsByteProgressForTheSelectedReceiver() throws {
    let engine = FakeExtensionSyncEngine(events: [
      .outboundTransferProgress(
        entryId: "shared-entry",
        peerId: "peer-1",
        completedBytes: 64,
        totalBytes: 128
      ),
      .outboundTransferStatusChanged(
        entryId: "shared-entry",
        peerId: "peer-1",
        status: "completed",
        reason: nil
      ),
    ])
    let coordinator = ExtensionSyncCoordinator(engine: engine)
    var progress: [ExtensionTransferProgress] = []

    try coordinator.waitForOutboundDelivery(
      entryId: "shared-entry",
      expectedReceiverCount: 1,
      timeoutMs: 1_000,
      onTransferProgress: { progress.append($0) }
    )

    XCTAssertEqual(
      progress,
      [ExtensionTransferProgress(peerId: "peer-1", completedBytes: 64, totalBytes: 128)]
    )
  }

  func testOutboundDeliveryIgnoresDuplicateAndUnrelatedCompletionEvents() throws {
    let engine = FakeExtensionSyncEngine(events: [
      .outboundTransferStatusChanged(
        entryId: "other-entry",
        peerId: "peer-other",
        status: "completed",
        reason: nil
      ),
      .outboundTransferStatusChanged(
        entryId: "shared-entry",
        peerId: "peer-1",
        status: "completed",
        reason: nil
      ),
      .outboundTransferStatusChanged(
        entryId: "shared-entry",
        peerId: "peer-1",
        status: "completed",
        reason: nil
      ),
      .outboundTransferStatusChanged(
        entryId: "shared-entry",
        peerId: "peer-2",
        status: "completed",
        reason: nil
      ),
    ])
    let coordinator = ExtensionSyncCoordinator(engine: engine)

    try coordinator.waitForOutboundDelivery(
      entryId: "shared-entry",
      expectedReceiverCount: 2,
      timeoutMs: 1_000
    )

    XCTAssertEqual(engine.eventTimeouts.count, 4)
  }

  func testOutboundDeliverySurfacesReceiverFailure() {
    let engine = FakeExtensionSyncEngine(events: [
      .outboundTransferStatusChanged(
        entryId: "shared-entry",
        peerId: "peer-1",
        status: "failed",
        reason: "receiver fetch failed"
      )
    ])
    let coordinator = ExtensionSyncCoordinator(engine: engine)

    XCTAssertThrowsError(
      try coordinator.waitForOutboundDelivery(
        entryId: "shared-entry",
        expectedReceiverCount: 1,
        timeoutMs: 1_000
      )
    ) { error in
      XCTAssertEqual(
        error as? ExtensionOutboundDeliveryError,
        .failed(reason: "receiver fetch failed")
      )
    }
  }

  func testOutboundDeliverySurfacesReceiverCancellation() {
    let engine = FakeExtensionSyncEngine(events: [
      .outboundTransferStatusChanged(
        entryId: "shared-entry",
        peerId: "peer-1",
        status: "cancelled",
        reason: "remote_peer"
      )
    ])
    let coordinator = ExtensionSyncCoordinator(engine: engine)

    XCTAssertThrowsError(
      try coordinator.waitForOutboundDelivery(
        entryId: "shared-entry",
        expectedReceiverCount: 1,
        timeoutMs: 1_000
      )
    ) { error in
      XCTAssertEqual(
        error as? ExtensionOutboundDeliveryError,
        .cancelled(reason: "remote_peer")
      )
    }
  }

  func testOutboundDeliveryTimesOutWithoutTerminalEvent() {
    let engine = FakeExtensionSyncEngine(events: [])
    let coordinator = ExtensionSyncCoordinator(engine: engine)

    XCTAssertThrowsError(
      try coordinator.waitForOutboundDelivery(
        entryId: "shared-entry",
        expectedReceiverCount: 1,
        timeoutMs: 1_000
      )
    ) { error in
      XCTAssertEqual(error as? ExtensionOutboundDeliveryError, .timedOut)
    }
  }

  func testOutboundDeliveryWithoutAcceptedReceiversReturnsImmediately() throws {
    let engine = FakeExtensionSyncEngine(events: [])
    let coordinator = ExtensionSyncCoordinator(engine: engine)

    try coordinator.waitForOutboundDelivery(
      entryId: "shared-entry",
      expectedReceiverCount: 0,
      timeoutMs: 1_000
    )

    XCTAssertTrue(engine.eventTimeouts.isEmpty)
  }

  func testDeferredDownloadRequirementMatchesCoreImageThreshold() {
    XCTAssertFalse(ExtensionOutboundDeliveryPolicy.requiresRemoteDownloadForImage(byteCount: 64 * 1024))
    XCTAssertTrue(
      ExtensionOutboundDeliveryPolicy.requiresRemoteDownloadForImage(byteCount: 64 * 1024 + 1)
    )
  }

  private func report(
    accepted: UInt64 = 0,
    duplicate: UInt64 = 0,
    offline: UInt64 = 0,
    errored: UInt64 = 0,
    pending: UInt64 = 0
  ) -> ExtensionDeliveryReport {
    ExtensionDeliveryReport(
      entryId: "entry",
      accepted: accepted,
      duplicate: duplicate,
      offline: offline,
      errored: errored,
      pending: pending
    )
  }
}

private final class FakeExtensionSyncEngine: ExtensionSyncEngine {
  private var events: [ExtensionSyncEvent]
  private var currentRemoteEntryId: String?
  private var restoreResults: [Bool]
  private(set) var refreshCalls = 0
  private(set) var currentRemoteEntryQueries = 0
  private(set) var eventTimeouts: [UInt64] = []
  private(set) var restoredEntryIds: [String] = []
  private var refreshReports: [ExtensionPeerRefreshReport]
  let refreshReport: ExtensionPeerRefreshReport

  var remainingEventCount: Int { events.count }

  init(
    events: [ExtensionSyncEvent],
    currentRemoteEntryId: String? = nil,
    restoreResults: [Bool] = [],
    refreshReport: ExtensionPeerRefreshReport = ExtensionPeerRefreshReport(
      total: 1,
      online: 1,
      offline: 0,
      errors: 0
    ),
    refreshReports: [ExtensionPeerRefreshReport]? = nil
  ) {
    self.events = events
    self.currentRemoteEntryId = currentRemoteEntryId
    self.restoreResults = restoreResults
    self.refreshReport = refreshReport
    self.refreshReports = refreshReports ?? [refreshReport]
  }

  func queryCurrentRemoteClipboardEntryId() throws -> String? {
    currentRemoteEntryQueries += 1
    return currentRemoteEntryId
  }

  func refreshPeerConnections() throws -> ExtensionPeerRefreshReport {
    refreshCalls += 1
    guard refreshReports.count > 1 else { return refreshReports[0] }
    return refreshReports.removeFirst()
  }

  func nextEvent(timeoutMs: UInt64) throws -> ExtensionSyncEvent? {
    eventTimeouts.append(timeoutMs)
    guard !events.isEmpty else { return nil }
    return events.removeFirst()
  }

  func restoreRemoteClipboard(entryId: String) throws -> Bool {
    restoredEntryIds.append(entryId)
    guard !restoreResults.isEmpty else { return false }
    return restoreResults.removeFirst()
  }
}
