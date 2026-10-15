import CryptoKit
import Foundation

/// How a staged copy relates to the file list the Engine reported when it flushed.
public enum NetworkLogEngineCheck: String, Sendable {
  /// The staged bytes hash to exactly what the Engine reported.
  case exact
  /// The first reported bytes hash to the reported value; the writer appended afterwards.
  case appendedAfterSnapshot
  /// The reported prefix does not hash to the reported value, or the file is shorter than reported.
  case mismatch
  /// The Engine did not list this file (another run, or no flush happened).
  case notReported
}

public struct NetworkLogStagedFile: Sendable {
  public let role: String
  public let runId: String
  public let name: String
  public let bytes: UInt64
  public let sha256: String
  public let stagedPath: String
  public let isCurrentRun: Bool
  public let engineCheck: NetworkLogEngineCheck
}

public struct NetworkLogStagedExport: Sendable {
  public let exportId: String
  public let files: [NetworkLogStagedFile]
  /// Run directories that were found, whether or not any file could be staged.
  public let discoveredRunCount: Int
  /// Entries that are not part of the export contract (lease locks, foreign files, links).
  public let skippedEntryCount: Int
  public let unreadableFileCount: Int
}

/// Copies only the allowlisted files of `<root>/<role>/<run>/` into a private staging directory.
///
/// A recursive copy of the network directory would carry the active-writer `lease.lock`, the
/// root `.cleanup.lock` and any unexpected file into the diagnostic package. Staging also gives
/// the exporter a stable snapshot: the live writer keeps appending while the package is built.
public enum NetworkLogExportStaging {
  static let manifestName = "run.json"

  static func isSafeComponent(_ value: String) -> Bool {
    !value.isEmpty && value.count <= 64
      && value.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }
  }

  /// `network.<8 digit UTC date>.<3 or more digit sequence>.jsonl`, or the run manifest.
  public static func isExportableName(_ name: String) -> Bool {
    if name == manifestName { return true }
    let parts = name.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 4, parts[0] == "network", parts[3] == "jsonl" else { return false }
    let date = parts[1], sequence = parts[2]
    return date.count == 8 && date.allSatisfy(\.isASCII) && date.allSatisfy(\.isNumber)
      && sequence.count >= 3 && sequence.allSatisfy(\.isASCII) && sequence.allSatisfy(\.isNumber)
  }

  public static func stage(
    root: URL,
    currentRunDirectory: URL?,
    engineFiles: [(name: String, bytes: UInt64, sha256: String)],
    stagingRoot: URL,
    fileManager: FileManager = .default
  ) throws -> NetworkLogStagedExport {
    try pruneStale(stagingRoot: stagingRoot, fileManager: fileManager)
    let exportId = UUID().uuidString.lowercased()
    let directory = stagingRoot.appendingPathComponent(exportId, isDirectory: true)
    try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    let reported = Dictionary(engineFiles.map { ($0.name, ($0.bytes, $0.sha256)) }, uniquingKeysWith: { first, _ in first })
    let currentPath = currentRunDirectory?.resolvingSymlinksInPath().path

    var files: [NetworkLogStagedFile] = []
    var runCount = 0, skipped = 0, unreadable = 0
    for role in subdirectories(of: root, fileManager: fileManager, skipped: &skipped) {
      guard isSafeComponent(role.lastPathComponent) else { skipped += 1; continue }
      for run in subdirectories(of: role, fileManager: fileManager, skipped: &skipped) {
        guard isSafeComponent(run.lastPathComponent) else { skipped += 1; continue }
        runCount += 1
        let isCurrent = run.resolvingSymlinksInPath().path == currentPath
        let entries = (try? fileManager.contentsOfDirectory(
          at: run, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey], options: []
        )) ?? []
        for entry in entries.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
          let name = entry.lastPathComponent
          let values = try? entry.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
          guard isExportableName(name), values?.isRegularFile == true, values?.isSymbolicLink != true else {
            skipped += 1
            continue
          }
          let target = directory.appendingPathComponent("\(role.lastPathComponent)__\(run.lastPathComponent)__\(name)")
          do {
            let copy = try copyHashing(
              from: entry, to: target, reportedPrefix: isCurrent ? reported[name] : nil
            )
            files.append(NetworkLogStagedFile(
              role: role.lastPathComponent, runId: run.lastPathComponent, name: name,
              bytes: copy.bytes, sha256: copy.sha256, stagedPath: target.path,
              isCurrentRun: isCurrent, engineCheck: copy.check
            ))
          } catch {
            try? fileManager.removeItem(at: target)
            unreadable += 1
          }
        }
      }
    }
    return NetworkLogStagedExport(
      exportId: exportId, files: files, discoveredRunCount: runCount,
      skippedEntryCount: skipped, unreadableFileCount: unreadable
    )
  }

  public static func release(exportId: String, stagingRoot: URL, fileManager: FileManager = .default) {
    guard UUID(uuidString: exportId) != nil else { return }
    try? fileManager.removeItem(at: stagingRoot.appendingPathComponent(exportId.lowercased(), isDirectory: true))
  }

  /// A package that was never released (the app was killed mid-export) must not leak logs.
  static func pruneStale(stagingRoot: URL, maximumAge: TimeInterval = 3_600, fileManager: FileManager = .default) throws {
    guard fileManager.fileExists(atPath: stagingRoot.path) else { return }
    let entries = try fileManager.contentsOfDirectory(
      at: stagingRoot, includingPropertiesForKeys: [.contentModificationDateKey], options: []
    )
    for entry in entries {
      let modified = (try? entry.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
      if Date().timeIntervalSince(modified ?? .distantPast) > maximumAge { try? fileManager.removeItem(at: entry) }
    }
  }

  private static func subdirectories(of url: URL, fileManager: FileManager, skipped: inout Int) -> [URL] {
    let entries = (try? fileManager.contentsOfDirectory(
      at: url, includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey], options: []
    )) ?? []
    var result: [URL] = []
    for entry in entries.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
      let values = try? entry.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
      if values?.isDirectory == true, values?.isSymbolicLink != true { result.append(entry) } else { skipped += 1 }
    }
    return result
  }

  private static func hex(_ digest: SHA256.Digest) -> String { digest.map { String(format: "%02x", $0) }.joined() }

  private static func copyHashing(
    from source: URL, to target: URL, reportedPrefix: (UInt64, String)?
  ) throws -> (bytes: UInt64, sha256: String, check: NetworkLogEngineCheck) {
    let input = try FileHandle(forReadingFrom: source)
    defer { try? input.close() }
    FileManager.default.createFile(atPath: target.path, contents: nil)
    let output = try FileHandle(forWritingTo: target)
    defer { try? output.close() }
    var hasher = SHA256()
    var total: UInt64 = 0
    var prefixDigest: String?
    if let reportedPrefix, reportedPrefix.0 == 0 { prefixDigest = hex(hasher.finalize()) }
    while let chunk = try input.read(upToCount: 64 * 1024), !chunk.isEmpty {
      let data = chunk
      if let reportedPrefix, prefixDigest == nil, total + UInt64(data.count) >= reportedPrefix.0 {
        let head = Int(reportedPrefix.0 - total)
        var prefixHasher = hasher
        prefixHasher.update(data: data.prefix(head))
        prefixDigest = hex(prefixHasher.finalize())
      }
      hasher.update(data: data)
      total += UInt64(data.count)
      try output.write(contentsOf: data)
    }
    let digest = hex(hasher.finalize())
    let check: NetworkLogEngineCheck
    if let reportedPrefix {
      if total == reportedPrefix.0, digest == reportedPrefix.1 { check = .exact }
      else if total > reportedPrefix.0, prefixDigest == reportedPrefix.1 { check = .appendedAfterSnapshot }
      else { check = .mismatch }
    } else {
      check = .notReported
    }
    return (total, digest, check)
  }
}
