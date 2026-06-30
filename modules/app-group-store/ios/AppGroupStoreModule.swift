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
}
