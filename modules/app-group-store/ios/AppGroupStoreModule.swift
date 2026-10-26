import ExpoModulesCore
import Foundation
import UIKit
import UniformTypeIdentifiers

public class AppGroupStoreModule: Module {
  private lazy var store = SettingsStore()
  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()

  public func definition() -> ModuleDefinition {
    Name("AppGroupStore")

    AsyncFunction("saveSettings") { (json: String) throws -> Void in
      return try SharedStorageAccess.shared.withAccess {
        let settings = try self.decoder.decode(AppSettings.self, from: Data(json.utf8))
        self.store.saveAppSettings(settings)
      }
    }

    AsyncFunction("getSettings") { () throws -> String in
      return try SharedStorageAccess.shared.withAccess {
        let data = try self.encoder.encode(self.store.loadAppSettings())
        return String(data: data, encoding: .utf8) ?? "{}"
      }
    }

    AsyncFunction("getLanServerPassword") { (serverId: String) throws -> String? in
      return try SharedStorageAccess.shared.withAccess {
        try LanServerCredentialStore.loadAndMigratePassword(serverId: serverId)
      }
    }

    AsyncFunction("setLanServerPassword") { (serverId: String, password: String) throws -> Void in
      return try SharedStorageAccess.shared.withAccess {
        try LanServerCredentialStore.setPassword(password, serverId: serverId)
      }
    }

    AsyncFunction("deleteLanServerPassword") { (serverId: String) throws -> Void in
      return try SharedStorageAccess.shared.withAccess {
        try LanServerCredentialStore.deletePassword(serverId: serverId, includeLegacy: true)
      }
    }

    AsyncFunction("getLegacyLanConfiguration") { () throws -> String? in
      return try SharedStorageAccess.shared.withAccess {
        SettingsStore.loadLegacyLanConfigurationJSON()
      }
    }

    // Free signal: reading changeCount never triggers the iOS paste
    // permission prompt, unlike reading the pasteboard's actual contents.
    Function("getPasteboardChangeCount") { () -> Int in
      UIPasteboard.general.changeCount
    }

    AsyncFunction("setPasteboardImageFromFile") { (fileUri: String) async throws -> Void in
      return try await SharedStorageAccess.shared.withAccess {
        let url = try AppGroupStoreModule.fileURL(fileUri)
        let data = try Data(contentsOf: url, options: [.mappedIfSafe])
        guard !data.isEmpty else {
          throw AppGroupStoreError.emptyPasteboardImage
        }
        let pasteboardType = UTType(filenameExtension: url.pathExtension)?.identifier
          ?? UTType.png.identifier
        await MainActor.run {
          UIPasteboard.general.setData(data, forPasteboardType: pasteboardType)
        }
      }
    }

    Function("getAppGroupId") { () -> String in SettingsStore.appGroupID }

    AsyncFunction("getContainerUrl") { () throws -> String? in
      try SharedStorageAccess.shared.withAccess {
        FileManager.default
          .containerURL(forSecurityApplicationGroupIdentifier: SettingsStore.appGroupID)?
          .absoluteString
      }
    }

    AsyncFunction("getLegacyHistory") { () throws -> String? in
      return try SharedStorageAccess.shared.withAccess {
        let history = self.store.loadHistory()
        guard !history.isEmpty else { return nil }
        let data = try self.encoder.encode(history)
        return String(data: data, encoding: .utf8)
      }
    }

    AsyncFunction("getShareDiagnostics") { () throws -> String? in
      return try SharedStorageAccess.shared.withAccess {
        guard let containerURL = FileManager.default.containerURL(
          forSecurityApplicationGroupIdentifier: SettingsStore.appGroupID
        ) else { return nil }
        let archive = try ShareDiagnosticsStore(containerURL: containerURL).loadArchive()
        let data = try self.encoder.encode(archive)
        return String(data: data, encoding: .utf8)
      }
    }

    // Engine trace files live under the shared P2P private data directory
    // (`p2p/data/logs`); the JS side cannot enumerate it through the app
    // sandbox. The legacy `p2p/cache/logs` is listed after it.
    Function("getEngineLogFileUris") { () throws -> [String] in
      return try SharedStorageAccess.shared.withAccess {
        guard let containerURL = FileManager.default.containerURL(
          forSecurityApplicationGroupIdentifier: SettingsStore.appGroupID
        ) else { return [] }
        return EngineLogLocator.logFiles(in: containerURL).map(\.path)
      }
    }

    AsyncFunction("getPayloadFileUri") { (profileId: String) throws -> String? in
      return try SharedStorageAccess.shared.withAccess {
        AppGroupStoreModule.payloadURL(profileId: profileId)?.absoluteString
      }
    }

    AsyncFunction("writePayload") { (profileId: String, bytes: Data) async throws -> String? in
      return try await SharedStorageAccess.shared.withAccess {
        let url = try await PayloadCache.shared.write(profileId: profileId, bytes: bytes)
        return url.absoluteString
      }
    }

    AsyncFunction("deletePayload") { (profileId: String) async throws -> Void in
      return try await SharedStorageAccess.shared.withAccess {
        await PayloadCache.shared.delete(profileId: profileId)
      }
    }

    AsyncFunction("clearPayloads") { () async throws -> Void in
      return try await SharedStorageAccess.shared.withAccess {
        await PayloadCache.shared.purgeAll()
      }
    }

    AsyncFunction("getPayloadStats") { () throws -> [String: Int] in
      return try SharedStorageAccess.shared.withAccess {
        self.payloadStats()
      }
    }

    AsyncFunction("claimOutboundShareJobs") { () throws -> [[String: Any]] in
      return try SharedStorageAccess.shared.withAccess {
        try self.claimOutboundShareJobs()
      }
    }

    AsyncFunction("completeOutboundShareJob") { (id: String) throws -> Void in
      return try SharedStorageAccess.shared.withAccess {
        try OutboundShareStore().completeJob(id: id)
      }
    }

    AsyncFunction("releaseOutboundShareJob") { (id: String) throws -> Void in
      return try SharedStorageAccess.shared.withAccess {
        try OutboundShareStore().releaseJob(id: id)
      }
    }

    AsyncFunction("recordShareDiagnosticStage") {
      (attemptId: String, stage: String, errorCode: String?) throws -> Void in
      return try SharedStorageAccess.shared.withAccess {
        guard let containerURL = FileManager.default.containerURL(
          forSecurityApplicationGroupIdentifier: SettingsStore.appGroupID
        ) else { return }
        let store = try ShareDiagnosticsStore(containerURL: containerURL)
        guard let stage = ShareDiagnosticStage(rawValue: stage) else { return }
        let error = errorCode.flatMap { ShareDiagnosticErrorCode(rawValue: $0) }
          .map { ShareDiagnosticError(code: $0) }
        store.record(stage: stage, error: error, for: attemptId)
      }
    }

    AsyncFunction("importPayloadFile") { (profileId: String, sourceUri: String) throws -> String? in
      return try SharedStorageAccess.shared.withAccess {
        try self.importPayloadFile(profileId: profileId, sourceUri: sourceUri)
      }
    }

    AsyncFunction("migrateLegacyContainer") { () throws -> [String: Any] in
      return try SharedStorageAccess.shared.withAccess {
        let result = try SettingsStore.migrateLegacyContainer()
        return ["migrated": result.migrated, "keys": result.keys]
      }
    }

    AsyncFunction("clearLegacyLanConfiguration") { () throws -> Void in
      return try SharedStorageAccess.shared.withAccess {
        try SettingsStore.clearLegacyLanConfiguration()
      }
    }

    AsyncFunction("getKeyboardStatus") { () throws -> [String: Any] in
      return try SharedStorageAccess.shared.withAccess {
        self.keyboardStatus()
      }
    }
  }

  private static func fileURL(_ raw: String) throws -> URL {
    if let url = URL(string: raw), url.isFileURL {
      return url
    }
    guard raw.hasPrefix("/") else {
      throw AppGroupStoreError.invalidFileURL
    }
    return URL(fileURLWithPath: raw)
  }

  private func payloadStats() -> [String: Int] {
    let directory = AppGroupStoreModule.payloadDirectory()
    let urls = (try? FileManager.default.contentsOfDirectory(
      at: directory,
      includingPropertiesForKeys: [.fileSizeKey, .isRegularFileKey]
    )) ?? []

    var count = 0
    var totalSize = 0
    for url in urls {
      guard let values = try? url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey]),
            values.isRegularFile == true
      else { continue }
      count += 1
      totalSize += values.fileSize ?? 0
    }
    return ["count": count, "totalSize": totalSize]
  }

  private func claimOutboundShareJobs() throws -> [[String: Any]] {
    try OutboundShareStore().claimPendingJobs().map { claimed in
      let job = claimed.job
      return [
        "id": job.id,
        "kind": job.kind.rawValue,
        "fileUri": claimed.fileURL.absoluteString,
        "displayName": job.displayName,
        "byteCount": job.byteCount,
        "mimeType": job.mimeType ?? NSNull(),
        "targetDeviceIds": job.targetDeviceIds ?? [],
        "createdAtMs": job.createdAtMs,
      ]
    }
  }

  private func importPayloadFile(profileId: String, sourceUri: String) throws -> String? {
    guard AppGroupStoreModule.isValidPayloadKey(profileId),
          let sourceURL = URL(string: sourceUri),
          sourceURL.isFileURL
    else { return nil }

    let targetURL = AppGroupStoreModule.payloadDirectory()
      .appendingPathComponent(profileId, isDirectory: false)
    if FileManager.default.fileExists(atPath: targetURL.path) {
      return targetURL.absoluteString
    }

    let temporaryURL = targetURL.deletingLastPathComponent()
      .appendingPathComponent(".\(profileId).\(UUID().uuidString).importing")
    defer { try? FileManager.default.removeItem(at: temporaryURL) }
    try FileManager.default.copyItem(at: sourceURL, to: temporaryURL)
    try FileManager.default.setAttributes(
      [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
      ofItemAtPath: temporaryURL.path
    )
    do {
      try FileManager.default.moveItem(at: temporaryURL, to: targetURL)
    } catch where FileManager.default.fileExists(atPath: targetURL.path) {
      // Another importer won the content-addressed race; its payload is equivalent.
    }
    return targetURL.absoluteString
  }

  private func keyboardStatus() -> [String: Any] {
    var status: [String: Any] = [:]
    if let keyboards = UserDefaults.standard.object(forKey: "AppleKeyboards") as? [String],
       let bundleId = Bundle.main.bundleIdentifier {
      let keyboardBundleId = bundleId + ".Keyboard"
      status["enabledInSystem"] = keyboards.contains {
        $0 == keyboardBundleId || $0.hasPrefix(keyboardBundleId + "@")
      }
    }
    let group = UserDefaults(suiteName: SettingsStore.appGroupID)
    status["everUsed"] =
      group?.bool(forKey: AppSettings.PersistenceKey.keyboardExtensionEnabled) ?? false
    status["lastKnownFullAccess"] =
      group?.bool(forKey: AppSettings.PersistenceKey.keyboardExtensionFullAccess) ?? false
    if let heartbeatAt = group?.object(
      forKey: AppSettings.PersistenceKey.keyboardExtensionHeartbeatAt
    ) as? Double {
      status["lastHeartbeatAtMs"] = heartbeatAt * 1000
    }
    return status
  }

  private static func payloadDirectory() -> URL {
    let container = FileManager.default
      .containerURL(forSecurityApplicationGroupIdentifier: SettingsStore.appGroupID)
      ?? FileManager.default.temporaryDirectory
        .appendingPathComponent("uniclipboard-payloads-fallback", isDirectory: true)
    let directory = container.appendingPathComponent("payloads", isDirectory: true)
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }

  private static func payloadURL(profileId: String) -> URL? {
    guard isValidPayloadKey(profileId) else { return nil }
    let url = payloadDirectory().appendingPathComponent(profileId, isDirectory: false)
    return FileManager.default.fileExists(atPath: url.path) ? url : nil
  }

  private static func isValidPayloadKey(_ key: String) -> Bool {
    !key.isEmpty
      && !key.contains("/")
      && !key.contains("\\")
      && key != "."
      && key != ".."
  }
}

private enum AppGroupStoreError: LocalizedError {
  case invalidFileURL
  case emptyPasteboardImage

  var errorDescription: String? {
    switch self {
    case .invalidFileURL:
      return "The image path is not a local file URL"
    case .emptyPasteboardImage:
      return "The image file is empty"
    }
  }
}
