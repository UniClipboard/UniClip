import Foundation

/// Locates Engine log files inside the App Group container.
///
/// Engine writes `<private_data_directory>/logs`, and the iOS host passes
/// `<container>/p2p/data` as that directory. `p2p/cache/logs` is the layout
/// used before the logs moved out of the cache; it is read only for installs
/// whose one-time migration has not run yet.
enum EngineLogLocator {
  static let directories = ["p2p/data/logs", "p2p/cache/logs"]

  static func logFiles(in container: URL) -> [URL] {
    directories.flatMap { relative -> [URL] in
      let directory = container.appendingPathComponent(relative, isDirectory: true)
      let urls = (try? FileManager.default.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: [.isRegularFileKey],
        options: [.skipsHiddenFiles]
      )) ?? []
      return urls
        .filter { url in
          guard let values = try? url.resourceValues(forKeys: [.isRegularFileKey]),
            values.isRegularFile == true
          else { return false }
          let name = url.lastPathComponent
          return url.pathExtension == "txt" || (name.hasPrefix("engine.") && url.pathExtension == "jsonl")
        }
        .sorted { $0.lastPathComponent < $1.lastPathComponent }
    }
  }
}
