import ExpoModulesCore
import Foundation
import UIKit

public class AppGroupStoreModule: Module {
  private let store = SettingsStore()
  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()

  public func definition() -> ModuleDefinition {
    Name("AppGroupStore")

    AsyncFunction("saveServers") { (json: String) throws -> Void in
      let list = try self.decoder.decode(ServerConfigList.self, from: Data(json.utf8))
      self.store.saveServers(list)
    }

    AsyncFunction("getServers") { () throws -> String in
      let data = try self.encoder.encode(self.store.loadServers())
      return String(data: data, encoding: .utf8) ?? "{}"
    }

    AsyncFunction("saveSettings") { (json: String) throws -> Void in
      let settings = try self.decoder.decode(AppSettings.self, from: Data(json.utf8))
      self.store.saveAppSettings(settings)
    }

    AsyncFunction("getSettings") { () throws -> String in
      let data = try self.encoder.encode(self.store.loadAppSettings())
      return String(data: data, encoding: .utf8) ?? "{}"
    }

    // Free signal: reading changeCount never triggers the iOS paste
    // permission prompt, unlike reading the pasteboard's actual contents.
    Function("getPasteboardChangeCount") { () -> Int in
      UIPasteboard.general.changeCount
    }

    AsyncFunction("getContainerUrl") { () -> String? in
      FileManager.default
        .containerURL(forSecurityApplicationGroupIdentifier: SettingsStore.appGroupID)?
        .absoluteString
    }

    AsyncFunction("getLegacyHistory") { () throws -> String? in
      let history = self.store.loadHistory()
      guard !history.isEmpty else { return nil }
      let data = try self.encoder.encode(history)
      return String(data: data, encoding: .utf8)
    }

    AsyncFunction("getShareDiagnostics") { () throws -> String? in
      guard let containerURL = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: SettingsStore.appGroupID
      ) else { return nil }
      let archive = try ShareDiagnosticsStore(containerURL: containerURL).loadArchive()
      let data = try self.encoder.encode(archive)
      return String(data: data, encoding: .utf8)
    }

    AsyncFunction("getPayloadFileUri") { (profileId: String) -> String? in
      AppGroupStoreModule.payloadURL(profileId: profileId)?.absoluteString
    }

    AsyncFunction("writePayload") { (profileId: String, bytes: Data) async throws -> String? in
      let url = try await PayloadCache.shared.write(profileId: profileId, bytes: bytes)
      return url.absoluteString
    }

    AsyncFunction("deletePayload") { (profileId: String) async -> Void in
      await PayloadCache.shared.delete(profileId: profileId)
    }

    AsyncFunction("clearPayloads") { () async -> Void in
      await PayloadCache.shared.purgeAll()
    }

    AsyncFunction("getPayloadStats") { () async -> [String: Int] in
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

    AsyncFunction("claimOutboundShareJobs") { () throws -> [[String: Any]] in
      try OutboundShareStore().claimPendingJobs().map { claimed in
        let job = claimed.job
        return [
          "id": job.id,
          "fileUri": claimed.fileURL.absoluteString,
          "displayName": job.displayName,
          "byteCount": job.byteCount,
          "mimeType": job.mimeType ?? NSNull(),
          "channel": job.channel.rawValue,
          "serverId": job.serverId ?? NSNull(),
          "createdAtMs": job.createdAtMs,
        ]
      }
    }

    AsyncFunction("completeOutboundShareJob") { (id: String) throws -> Void in
      try OutboundShareStore().completeJob(id: id)
    }

    AsyncFunction("releaseOutboundShareJob") { (id: String) throws -> Void in
      try OutboundShareStore().releaseJob(id: id)
    }

    AsyncFunction("importPayloadFile") { (profileId: String, sourceUri: String) throws -> String? in
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

    AsyncFunction("sendOutboundLanFile") {
      (
        sourceUri: String,
        displayName: String,
        profileHash: String,
        byteCount: Int64,
        serverId: String?
      ) async throws -> Void in
      guard let sourceURL = URL(string: sourceUri), sourceURL.isFileURL,
            FileManager.default.fileExists(atPath: sourceURL.path)
      else { throw OutboundShareHandoffError.invalidSource }

      let servers = self.store.loadServers()
      let selected: ServerConfig?
      if let serverId {
        selected = servers.configs.first(where: { $0.id == serverId })
      } else {
        selected = servers.activeConfig
      }
      guard let server = selected else { throw SyncError(kind: .networkUnreachable) }
      let settings = self.store.loadAppSettings()
      let network = await NetworkContextDetector.current(store: self.store)
      let safeName = Clipboard.sanitizedFilename(displayName)
      let entry = Clipboard(
        type: .file,
        hash: profileHash,
        text: safeName,
        hasData: true,
        dataName: safeName,
        size: Int(clamping: byteCount)
      )

      try await ServerRouteExecutor(store: self.store).run(
        server: server,
        network: network,
        probe: { routed in
          let client = try SyncClipboardClient(
            server: routed,
            trustInsecureCert: settings.trustInsecureCert
          )
          try await client.probeReachability()
        },
        operation: { routed in
          let client = try SyncClipboardClient(
            server: routed,
            trustInsecureCert: settings.trustInsecureCert
          )
          try await client.putFile(
            name: safeName,
            fileURL: sourceURL,
            byteCount: byteCount
          )
          try await client.putClipboard(entry)
        }
      )
      self.store.saveLastSyncedHash(profileHash)
      self.store.saveLastSyncedContentId(nil)
    }

    AsyncFunction("getLastSyncedHash") { () -> String? in
      self.store.loadLastSyncedHash()
    }

    AsyncFunction("getLastSyncedContentId") { () -> String? in
      self.store.loadLastSyncedContentId()
    }

    AsyncFunction("getLiveUrl") { (configId: String) -> String? in
      self.store.loadLiveURL(configId: configId)
    }

    AsyncFunction("saveLiveUrl") { (configId: String, url: String?) -> Void in
      self.store.saveLiveURL(configId: configId, url)
    }

    AsyncFunction("migrateLegacyContainer") { () -> [String: Any] in
      let result = SettingsStore.migrateLegacyContainer()
      return ["migrated": result.migrated, "keys": result.keys]
    }

    AsyncFunction("getKeyboardStatus") { () -> [String: Any] in
      var status: [String: Any] = [:]

      // Live check against the system keyboard list. `AppleKeyboards` holds the
      // bundle ids of every enabled keyboard; absent (nil) on OS versions that
      // stopped exposing it, in which case the key is omitted and JS falls back
      // to the app-group heartbeat below.
      if let keyboards = UserDefaults.standard.object(forKey: "AppleKeyboards") as? [String],
         let bundleId = Bundle.main.bundleIdentifier {
        // System entries carry layout suffixes ("en_US@sw=QWERTY"); match the
        // extension bundle id with or without one.
        let keyboardBundleId = bundleId + ".Keyboard"
        status["enabledInSystem"] = keyboards.contains {
          $0 == keyboardBundleId || $0.hasPrefix(keyboardBundleId + "@")
        }
      }

      // Heartbeat flags the keyboard extension writes on every viewDidAppear.
      // `lastKnownFullAccess` is the state as of the keyboard's last appearance,
      // not necessarily the current Settings value.
      let group = UserDefaults(suiteName: SettingsStore.appGroupID)
      status["everUsed"] =
        group?.bool(forKey: AppSettings.PersistenceKey.keyboardExtensionEnabled) ?? false
      status["lastKnownFullAccess"] =
        group?.bool(forKey: AppSettings.PersistenceKey.keyboardExtensionFullAccess) ?? false
      return status
    }
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
