import ExpoModulesCore
import Foundation

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
