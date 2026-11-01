// Injected into the test build only. Not a production bridge field or API.
enum Crash199TestScheduler {
  private static let lock = NSLock()
  private static var root: URL { FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0] }
  static func record(_ event: String, activityId: Int? = nil) {
    lock.withLock {
      let file = root.appendingPathComponent("crash199-native.jsonl")
      var row: [String: Any] = ["event": event, "monotonicNs": String(DispatchTime.now().uptimeNanoseconds)]
      if let activityId { row["activityId"] = activityId }
      if event == "background.transition.returned" || event == "bridge.resume.finished",
        let group = Bundle.main.object(forInfoDictionaryKey: "UCAppGroupIdentifier") as? String,
        let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group),
        let files = NativeDiagnosticFiles.openFiles(under: container) {
        row["files"] = ["database": files.database, "lock": files.lock, "other": files.other]
      }
      let data = try! JSONSerialization.data(withJSONObject: row, options: [.sortedKeys]) + Data([10])
      if !FileManager.default.fileExists(atPath: file.path) { FileManager.default.createFile(atPath: file.path, contents: nil) }
      let handle = try! FileHandle(forWritingTo: file)
      try! handle.seekToEnd(); try! handle.write(contentsOf: data); try! handle.close()
    }
  }
  static func waitBeforeResume() throws {
    record("bridge.resume.entered")
    let gate = root.appendingPathComponent("crash199-hold-resume")
    let start = ProcessInfo.processInfo.systemUptime
    while FileManager.default.fileExists(atPath: gate.path) {
      if ProcessInfo.processInfo.systemUptime - start > 45 { throw NSError(domain: "crash199-test-gate", code: 1) }
      Thread.sleep(forTimeInterval: 0.01)
    }
    record("bridge.resume.released")
  }
  static func waitBeforeFlush() throws {
    record("flush.entered")
    let gate = root.appendingPathComponent("crash199-hold-flush")
    let start = ProcessInfo.processInfo.systemUptime
    while FileManager.default.fileExists(atPath: gate.path) {
      if ProcessInfo.processInfo.systemUptime - start > 45 { throw NSError(domain: "crash199-test-flush", code: 1) }
      Thread.sleep(forTimeInterval: 0.01)
    }
    record("flush.released")
  }

}
