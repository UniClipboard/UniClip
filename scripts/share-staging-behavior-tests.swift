// Standalone behavior check for the dumb share-extension staging flow.
//
// Compiles with swiftc alongside `targets/_shared/AppSettings.swift`,
// `targets/_shared/SettingsStore.swift` and `targets/share/OutboundShareHandoff.swift`
// (see `scripts/check-share-staging-behavior.sh`). Verifies the staging contract
// that the extension and the main app share: kind dispatch, UTF-8 text payloads,
// atomic pending records, claim/release/complete, lease recovery and expiry —
// the iOS-side counterpart of `pendingShareStore.android.test.ts`.

import Foundation

private var failures = 0

private func check(_ condition: @autoclosure () throws -> Bool, _ message: String) {
    do {
        if try condition() {
            print("[ ok ] \(message)")
        } else {
            failures += 1
            FileHandle.standardError.write(Data("[FAIL] \(message)\n".utf8))
        }
    } catch {
        failures += 1
        FileHandle.standardError.write(Data("[FAIL] \(message) (threw \(error))\n".utf8))
    }
}

private func withTempDirectory(
    _ body: (URL) async throws -> Void
) async throws {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("share-staging-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }
    try await body(dir)
}

private func run(_ name: String, _ body: () async throws -> Void) async throws {
    print("== \(name) ==")
    try await body()
}

@main
struct ShareStagingBehaviorTests {
    static func main() async throws {
        try await withTempDirectory { container in
            let store = try OutboundShareStore(containerURL: container)

            try await run("stage dispatches by kind") {
                let text = try store.stageText("你好,world")
                check(text.kind == .text, "stageText kind is .text")
                check(text.displayName == "分享的文本.txt", "stageText default displayName")
                check(text.mimeType == "text/plain", "stageText mime is text/plain")
                check(try Data(contentsOf: text.url) == Data("你好,world".utf8), "stageText payload is UTF-8")
                check(text.byteCount == Int64("你好,world".utf8.count), "stageText byteCount matches utf8 length")

                let image = try store.stageData(
                    Data([0xFF, 0xD8]),
                    displayName: "photo.jpg",
                    mimeType: "image/jpeg",
                    kind: .image
                )
                check(image.kind == .image, "stageData kind is .image")

                let source = container.appendingPathComponent("source.bin")
                try Data([1, 2, 3]).write(to: source)
                let file = try store.stageFile(at: source, displayName: "archive.bin")
                check(file.kind == .file, "stageFile kind is .file")
                check(try Data(contentsOf: file.url) == Data([1, 2, 3]), "stageFile preserves bytes")
            }

            try await run("enqueue persists kind and claim/release/complete round-trips") {
                let staged = try store.stageText("round trip")
                let job = try store.enqueue(staged)
                check(job.kind == .text, "enqueued job carries kind")

                let claimed = try store.claimPendingJobs()
                check(claimed.map(\.job) == [job], "claim returns the enqueued job")
                check(try Data(contentsOf: claimed[0].fileURL) == Data("round trip".utf8), "claimed payload readable")

                try store.releaseJob(id: job.id)
                check(try store.claimPendingJobs().map(\.job) == [job], "release keeps the job claimable")
                _ = try store.claimPendingJobs()

                try store.completeJob(id: job.id)
                check(try store.claimPendingJobs().isEmpty, "complete removes the job")
                check(!FileManager.default.fileExists(atPath: staged.url.path), "complete removes the payload")
            }

            try await run("legacy records without kind decode as .file") {
                let recentMs = Int64(Date().timeIntervalSince1970 * 1_000)
                let legacyURL = container.appendingPathComponent("outbound-handoff/pending/legacy.json")
                try Data("""
                {"id":"legacy","displayName":"old.bin","byteCount":3,"mimeType":null,
                 "targetDeviceIds":["desktop-1"],"createdAtMs":\(recentMs)}
                """.utf8).write(to: legacyURL, options: .atomic)
                let payloadURL = container.appendingPathComponent("outbound-handoff/files/legacy.payload")
                try Data([9, 9, 9]).write(to: payloadURL)

                let claimed = try store.claimPendingJobs()
                check(claimed.map(\.job.kind) == [.file], "legacy job decodes as .file")
                check(claimed.first?.job.targetDeviceIds == ["desktop-1"], "legacy targetDeviceIds kept as metadata")
            }

            try await run("abandoned processing jobs recover after the lease") {
                let staged = try store.stageData(Data([7, 8]), displayName: "lease.bin", mimeType: nil)
                let job = try store.enqueue(staged)
                check(try store.claimPendingJobs().map(\.job) == [job], "first claim moves job to processing")

                let record = container.appendingPathComponent("outbound-handoff/processing/\(job.id).json")
                try FileManager.default.setAttributes(
                    [.modificationDate: Date(timeIntervalSinceNow: -(16 * 60))],
                    ofItemAtPath: record.path
                )
                check(try store.claimPendingJobs().map(\.job) == [job], "lease expiry returns the job to pending")
            }

            try await run("expired jobs are cleaned with their payloads") {
                let staged = try store.stageData(Data([5]), displayName: "old.bin", mimeType: nil)
                let job = try store.enqueue(staged)
                try store.removeExpiredJobs(nowMs: job.createdAtMs + Int64(8 * 24 * 60 * 60 * 1_000))
                check(try store.claimPendingJobs().isEmpty, "expired job is gone")
                check(!FileManager.default.fileExists(atPath: staged.url.path), "expired payload is gone")            }

            try await run("history payload cache copies staged files") {
                let source = container.appendingPathComponent("staged.payload")
                try Data([4, 5, 6]).write(to: source)
                let cache = PayloadCache(
                    directory: container.appendingPathComponent("payloads", isDirectory: true),
                    maxBytes: 1024
                )
                let stored = try await cache.writeFile(profileId: "Image-ABC", from: source)
                check(try Data(contentsOf: stored) == Data([4, 5, 6]), "history cache keeps staged bytes")
            }
        }

        if failures > 0 {
            FileHandle.standardError.write(Data("\(failures) check(s) failed\n".utf8))
            exit(1)
        }
        print("All share staging behavior checks passed.")
    }
}
