import Foundation

func require(_ value: Bool, _ message: String) throws {
  if !value { throw NSError(domain: "OutboundReplay", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
}

func replay(_ output: URL) throws {
  var cases: [[String: Any]] = []
  let failure = try BridgeReplay.engineResult { throw BindingError.Engine(code: 1415, category: .unauthorized, retryable: false) }
  try require(failure["ok"] as? Bool == false, "failure envelope became success")
  let fields = failure["failure"] as! [String: Any]
  try require(fields["code"] as? UInt32 == 1415 && fields["category"] as? String == "unauthorized" && fields["retryable"] as? Bool == false, "failure fields lost")
  let itemStates = ["waiting", "transferring", "processing", "retrying", "completed", "failed", "cancelled", "unconfirmed"]
  let batchStates = ["no_items", "waiting", "in_progress", "unconfirmed", "partially_unconfirmed", "completed", "failed", "partially_failed", "cancelled", "partially_cancelled"]
  for state in batchStates {
    let items = itemStates.enumerated().map { index, itemState in
      OutboundProgressItem(kind: "file", index: UInt16(index), state: itemState,
        lastKnownPhase: index == 0 ? nil : "processing", round: index == 0 ? nil : UInt32.max,
        completedBytes: index == 0 ? nil : UInt64.max, totalBytes: nil,
        failureReason: itemState == "failed" ? "storage" : nil,
        cancellationReason: itemState == "cancelled" ? "local_user" : nil)
    }
    let progress = OutboundProgress(entryId: "synthetic-entry", targetDeviceId: "synthetic-target", attemptId: nil,
      revision: UInt64.max, freshness: "unconfirmed", freshnessAvailable: false, state: state,
      itemsTotal: 8, itemsWaiting: 1, itemsRunning: 3, itemsCompleted: 1, itemsFailed: 1, itemsCancelled: 1,
      itemsUnconfirmed: 1, items: items)
    let mapped = BridgeReplay.outboundProgressMap(progress)
    try require(mapped["revision"] as? String == "18446744073709551615", "u64 revision rounded")
    try require(mapped["attemptId"] is NSNull, "null attempt lost")
    let mappedItems = mapped["items"] as! [[String: Any]]
    try require(mappedItems[0]["completedBytes"] is NSNull, "unknown bytes became zero")
    try require(mappedItems[1]["completedBytes"] as? String == "18446744073709551615", "u64 bytes rounded")
    try require(mappedItems[0]["round"] is NSNull, "null round lost")
    for classification in ["running", "settled", "superseded", "not_retained", "unsupported", "unreachable", "busy"] {
      let targets = [ResendTargetProgress(targetDeviceId: "synthetic-target", state: classification, current: progress,
        newTransferRequested: false, duplicateFilesPossible: true),
        ResendTargetProgress(targetDeviceId: "second-target", state: classification, current: nil,
        newTransferRequested: false, duplicateFilesPossible: false)]
      let outcome = BridgeReplay.resendOutcomeMap(.completed(reconciled: targets, accepted: 0, duplicate: 0, offline: 0, errored: 0, pending: 0))
      let reconciled = outcome["reconciled"] as! [[String: Any]]
      try require(reconciled.count == 2 && reconciled[0]["state"] as? String == classification, "target result lost")
      try require(reconciled[1]["current"] is NSNull, "absent current lost")
      try require((reconciled[0]["current"] as? [String: Any])?["state"] as? String == state, "complete current lost")
    }
    cases.append(["batch": state, "itemStates": itemStates, "allReconciliations": true, "passed": true])
  }
  // Actual Engine calls use a temporary profile and in-memory secure storage.
  let host = IsolatedHost(output.appendingPathComponent("profile"))
  let engine = try MobileEngine.start(config: BindingConfig(appVersion: "1.0.0", profileId: "default"), host: host)
  _ = try engine.createSpace(deviceName: "Synthetic progress host", passphrase: "synthetic progress host passphrase")
  try require(try engine.listOutboundProgress().isEmpty, "unexpected fresh outbound state")
  var queryErrorFields: [String: Any] = [:]
  do {
    try require(try engine.queryOutboundProgress(entryId: "missing", targetDeviceId: "missing") == nil, "missing entry fabricated")
  } catch let BindingError.Engine(code, category, retryable) {
    try require((category == .unauthorized || category == .invalidInput) && !retryable, "unexpected query error category")
    queryErrorFields = ["code": code, "category": String(describing: category), "retryable": retryable]
  }
  var queryError = false
  do { _ = try engine.reconcileOutboundProgress(entryId: "missing", targetDeviceId: "missing", expectedAttemptId: "old-attempt") }
  catch { queryError = true }
  // Absence may be a conservative classification or a typed error. Neither means delivered.
  var resendErrorFields: [String: Any] = [:]
  do {
    let resend = try engine.resendEntry(entryId: "missing", targetDevices: [], confirmNewTransfer: false)
    if case .completed(let reconciled, let accepted, _, _, _, _) = resend {
      try require(accepted == 0 && reconciled.isEmpty, "missing resend accepted a new transfer")
    }
  } catch let BindingError.Engine(code, category, retryable) {
    resendErrorFields = ["code": code, "category": String(describing: category), "retryable": retryable]
  }
  var released = false
  while !released {
    switch engine.shutdownWithOutcome(deadlineMs: 1000) {
    case .pending: Thread.sleep(forTimeInterval: 0.05)
    case .failed(let error): throw error
    case .released(let error):
      released = true
      if let error { throw error }
    }
  }
  cases.append(["case": "real isolated Engine query/list/reconcile/default resend/final shutdown", "queryError": queryError, "queryFailure": queryErrorFields, "resendFailure": resendErrorFields, "passed": true])
  let receipt: [String: Any] = ["scope": "Generated Swift DTO bridge mapping and real isolated macOS Engine actions. No App/UIKit/device execution.", "cases": cases]
  try JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys]).write(to: output.appendingPathComponent("native-replay.json"))
}
do {
  let output = URL(fileURLWithPath: CommandLine.arguments[1])
  try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
  try replay(output)
} catch { FileHandle.standardError.write(Data("Outbound replay failed: \(error)\n".utf8)); exit(1) }
