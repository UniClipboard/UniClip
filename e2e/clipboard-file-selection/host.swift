import Foundation

// In-memory UIKit boundary. Never accesses a system pasteboard.
enum BindingClipboardRepresentation {
  case inline(format: String, mimeType: String?, bytes: Data)
  case file(format: String, handle: String, displayName: String, mimeType: String?, sizeBytes: UInt64)
}
struct BindingClipboardSnapshot { let representations: [BindingClipboardRepresentation] }
struct UIImage { init?(data: Data) { return nil } }
struct UTType { let identifier: String; init?(mimeType: String) { identifier = mimeType } }
final class UIPasteboard {
  static let general = UIPasteboard()
  var items: [[String: Any]] = []
  var string: String?
  var image: UIImage?
  var url: URL?
  var data: Data?
  func setData(_ value: Data, forPasteboardType: String) { data = value }
  func reset() { items = []; string = nil; image = nil; url = nil; data = nil }
}
enum SystemHostError: Error { case io, unavailable, invalidHandle }
enum HostBindingError: Error { case Unavailable }
func onMain<T>(_ operation: () throws -> T) rethrows -> T { try operation() }
func withHostBindingError<T>(_ operation: () throws -> T) rethrows -> T { try operation() }
final class Files {
  var handles: [String: URL] = [:]
  func copy(_ handle: String, to target: URL) throws {
    guard let source = handles[handle] else { throw SystemHostError.invalidHandle }
    try FileManager.default.copyItem(at: source, to: target)
  }
}
final class Host {
  let p2pDirectory: URL
  let clipboardShares: AppleClipboardShareCache
  let files = Files()
  init(root: URL) { p2pDirectory = root; clipboardShares = AppleClipboardShareCache(root: root.appendingPathComponent("shares")) }
  func applicationSupportDirectory() throws -> URL { p2pDirectory }
  // PRODUCTION_METHOD
}

let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
let source = root.appendingPathComponent("00000000")
let expected = Data((0..<793).map { UInt8($0 % 239) })
try expected.write(to: source)
let host = Host(root: root)
host.files.handles["valid"] = source
let text = BindingClipboardRepresentation.inline(format: "text/plain", mimeType: "text/plain", bytes: Data("/sender/private/path.txt".utf8))
let file = BindingClipboardRepresentation.inline(format: "files", mimeType: "text/uri-list", bytes: Data((source.absoluteString + "\n").utf8))
let metadata = BindingClipboardRepresentation.inline(format: "uniclipboard-file-display-metadata", mimeType: "application/x-uniclipboard-file-display-metadata+json", bytes: Data(#"{"files":[{"storage_name":"00000000","display_name":"原始文件.txt"}]}"#.utf8))
let missing = BindingClipboardRepresentation.inline(format: "files", mimeType: "text/uri-list", bytes: Data(root.appendingPathComponent("missing").absoluteString.utf8))
let directory = BindingClipboardRepresentation.inline(format: "files", mimeType: "text/uri-list", bytes: Data(root.absoluteString.utf8))
let remote = BindingClipboardRepresentation.inline(format: "files", mimeType: "text/uri-list", bytes: Data("https://example.invalid/file".utf8))
let outside = root.deletingLastPathComponent().appendingPathComponent("outside.bin")
try expected.write(to: outside)
let link = root.appendingPathComponent("escape-link")
try? FileManager.default.removeItem(at: link)
try FileManager.default.createSymbolicLink(at: link, withDestinationURL: outside)
let escaped = BindingClipboardRepresentation.inline(format: "files", mimeType: "text/uri-list", bytes: Data(link.absoluteString.utf8))
let malformed = BindingClipboardRepresentation.inline(format: "files", mimeType: "text/uri-list", bytes: Data([0xff, 0xfe]))
let handle = BindingClipboardRepresentation.file(format: "application/octet-stream", handle: "valid", displayName: "原始文件.txt", mimeType: nil, sizeBytes: 793)
var results: [[String: Any]] = []
func check(_ name: String, _ reps: [BindingClipboardRepresentation], _ assertion: () throws -> Bool) {
  UIPasteboard.general.reset()
  do {
    let identity = try host.clipboardWrite(snapshot: BindingClipboardSnapshot(representations: reps))
    let checked = try assertion()
    let passed = identity == nil && checked
    results.append(["case": name, "passed": passed])
  } catch { results.append(["case": name, "passed": false, "error": String(describing: error)]) }
}
func sharedFileMatches() throws -> Bool {
  guard let url = UIPasteboard.general.url else { return false }
  return try Data(contentsOf: url) == expected && url.lastPathComponent == "原始文件.txt" && UIPasteboard.general.string == nil
}
check("text-first-bytes-and-filename", [metadata, text, file], sharedFileMatches)
check("file-first-bytes-and-filename", [file, text, metadata], sharedFileMatches)
check("handle-after-text", [text, handle], sharedFileMatches)
check("missing-before-valid", [missing, text, file, metadata], sharedFileMatches)
check("text-only", [text]) { UIPasteboard.general.string == "/sender/private/path.txt" }
check("missing-file-text-fallback", [missing, text]) { UIPasteboard.general.string == "/sender/private/path.txt" }
check("directory-text-fallback", [directory, text]) { UIPasteboard.general.string == "/sender/private/path.txt" }
check("symlink-escape-text-fallback", [escaped, text]) { UIPasteboard.general.string == "/sender/private/path.txt" }
check("malformed-file-text-fallback", [malformed, text]) { UIPasteboard.general.string == "/sender/private/path.txt" }
check("remote-uri-text-fallback", [remote, text]) { UIPasteboard.general.string == "/sender/private/path.txt" }
let html = Data("<p>中文</p>".utf8)
check("rich-text-fallback-preserved", [.inline(format: "text/html", mimeType: "text/html", bytes: html), text]) { UIPasteboard.general.data == html }
let rtf = Data(#"{\rtf1 synthetic}"#.utf8)
check("rtf-fallback-preserved", [.inline(format: "text/rtf", mimeType: "text/rtf", bytes: rtf), text]) { UIPasteboard.general.data == rtf }
check("metadata-only", [metadata]) { UIPasteboard.general.string == nil && UIPasteboard.general.url == nil && UIPasteboard.general.data == nil }
for (name, candidate) in [("unsupported-file-only", remote), ("missing-file-only", missing), ("invalid-handle", BindingClipboardRepresentation.file(format: "files", handle: "invalid", displayName: "x", mimeType: nil, sizeBytes: 0))] {
  UIPasteboard.general.reset()
  do {
    try host.clipboardWrite(snapshot: BindingClipboardSnapshot(representations: [candidate]))
    results.append(["case": name, "passed": false])
  } catch { results.append(["case": name, "passed": UIPasteboard.general.url == nil && UIPasteboard.general.string == nil]) }
}
let json = try JSONSerialization.data(withJSONObject: results, options: [.prettyPrinted, .sortedKeys])
print(String(decoding: json, as: UTF8.self))
exit(results.allSatisfy { $0["passed"] as? Bool == true } ? 0 : 1)
