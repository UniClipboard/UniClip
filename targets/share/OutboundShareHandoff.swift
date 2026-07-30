import CryptoKit
import Foundation

struct StagedShareFile: Equatable, Sendable {
    let id: String
    let url: URL
    let displayName: String
    let byteCount: Int64
    let mimeType: String?
}

enum OutboundShareChannel: String, Codable, Sendable {
    case p2p
    case lan
}

struct OutboundShareJob: Codable, Equatable, Sendable {
    let id: String
    let displayName: String
    let byteCount: Int64
    let mimeType: String?
    let channel: OutboundShareChannel
    let serverId: String?
    let createdAtMs: Int64
}

struct ClaimedOutboundShareJob: Equatable, Sendable {
    let job: OutboundShareJob
    let fileURL: URL
}

enum OutboundShareHandoffError: Error {
    case appGroupUnavailable
    case invalidSource
    case streamFailure
    case incompleteCopy(expected: Int64, actual: Int64)
    case missingPayload
}

enum OutboundShareFallbackPolicy {
    static func shouldHandoff(itemIsFile: Bool, connectionTimedOut: Bool) -> Bool {
        itemIsFile && connectionTimedOut
    }
}

final class OutboundShareStore: @unchecked Sendable {
    static let directSendLimitBytes: Int64 = 100 * 1024 * 1024
    static let copyBufferBytes = 1 * 1024 * 1024

    private static let processingLeaseMs: Int64 = 15 * 60 * 1_000
    private static let expirationMs: Int64 = 7 * 24 * 60 * 60 * 1_000

    private let fileManager: FileManager
    private let rootURL: URL
    private let filesURL: URL
    private let pendingURL: URL
    private let processingURL: URL
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(fileManager: FileManager = .default, containerURL: URL? = nil) throws {
        self.fileManager = fileManager
#if SWIFT_PACKAGE
        guard let container = containerURL else {
            throw OutboundShareHandoffError.appGroupUnavailable
        }
#else
        guard let container = containerURL ?? fileManager.containerURL(
            forSecurityApplicationGroupIdentifier: SettingsStore.appGroupID
        ) else {
            throw OutboundShareHandoffError.appGroupUnavailable
        }
#endif
        rootURL = container.appendingPathComponent("outbound-handoff", isDirectory: true)
        filesURL = rootURL.appendingPathComponent("files", isDirectory: true)
        pendingURL = rootURL.appendingPathComponent("pending", isDirectory: true)
        processingURL = rootURL.appendingPathComponent("processing", isDirectory: true)
        try createDirectories()
    }

    static func shouldSendDirectly(byteCount: Int64) -> Bool {
        byteCount <= directSendLimitBytes
    }

    func stageFile(
        at sourceURL: URL,
        displayName: String? = nil,
        mimeType: String? = nil
    ) throws -> StagedShareFile {
        guard sourceURL.isFileURL else { throw OutboundShareHandoffError.invalidSource }

        let id = UUID().uuidString.lowercased()
        let temporaryURL = filesURL.appendingPathComponent("\(id).staging")
        let payloadURL = filesURL.appendingPathComponent("\(id).payload")
        let accessed = sourceURL.startAccessingSecurityScopedResource()
        defer {
            if accessed { sourceURL.stopAccessingSecurityScopedResource() }
            try? fileManager.removeItem(at: temporaryURL)
        }

        let expectedSize = try fileSize(at: sourceURL)
        let copiedSize = try streamCopy(from: sourceURL, to: temporaryURL)
        guard copiedSize == expectedSize else {
            throw OutboundShareHandoffError.incompleteCopy(expected: expectedSize, actual: copiedSize)
        }
        try fileManager.moveItem(at: temporaryURL, to: payloadURL)
        try protectFile(at: payloadURL)

        return StagedShareFile(
            id: id,
            url: payloadURL,
            displayName: Self.safeDisplayName(displayName ?? sourceURL.lastPathComponent),
            byteCount: copiedSize,
            mimeType: mimeType
        )
    }

    func stageData(_ data: Data, displayName: String, mimeType: String?) throws -> StagedShareFile {
        let id = UUID().uuidString.lowercased()
        let temporaryURL = filesURL.appendingPathComponent("\(id).staging")
        let payloadURL = filesURL.appendingPathComponent("\(id).payload")
        defer { try? fileManager.removeItem(at: temporaryURL) }

        try data.write(to: temporaryURL, options: .atomic)
        try fileManager.moveItem(at: temporaryURL, to: payloadURL)
        try protectFile(at: payloadURL)
        return StagedShareFile(
            id: id,
            url: payloadURL,
            displayName: Self.safeDisplayName(displayName),
            byteCount: Int64(data.count),
            mimeType: mimeType
        )
    }

    @discardableResult
    func enqueue(
        _ staged: StagedShareFile,
        channel: OutboundShareChannel,
        serverId: String?
    ) throws -> OutboundShareJob {
        guard fileManager.fileExists(atPath: staged.url.path) else {
            throw OutboundShareHandoffError.missingPayload
        }
        let job = OutboundShareJob(
            id: staged.id,
            displayName: staged.displayName,
            byteCount: staged.byteCount,
            mimeType: staged.mimeType,
            channel: channel,
            serverId: serverId,
            createdAtMs: Self.nowMs
        )
        let data = try encoder.encode(job)
        try data.write(to: pendingRecordURL(id: job.id), options: .atomic)
        return job
    }

    func claimPendingJobs() throws -> [ClaimedOutboundShareJob] {
        try recoverAbandonedProcessingJobs()
        try removeExpiredJobs()
        let records = try recordURLs(in: pendingURL)
        var claimed: [ClaimedOutboundShareJob] = []

        for pendingRecord in records {
            let processingRecord = processingURL.appendingPathComponent(pendingRecord.lastPathComponent)
            do {
                try fileManager.moveItem(at: pendingRecord, to: processingRecord)
            } catch {
                continue
            }
            do {
                let job = try decoder.decode(OutboundShareJob.self, from: Data(contentsOf: processingRecord))
                let payload = payloadURL(id: job.id)
                guard fileManager.fileExists(atPath: payload.path) else {
                    try? fileManager.removeItem(at: processingRecord)
                    continue
                }
                claimed.append(ClaimedOutboundShareJob(job: job, fileURL: payload))
            } catch {
                try? fileManager.removeItem(at: processingRecord)
            }
        }
        return claimed.sorted { $0.job.createdAtMs < $1.job.createdAtMs }
    }

    func releaseJob(id: String) throws {
        let processingRecord = processingRecordURL(id: id)
        guard fileManager.fileExists(atPath: processingRecord.path) else { return }
        let pendingRecord = pendingRecordURL(id: id)
        if fileManager.fileExists(atPath: pendingRecord.path) {
            try fileManager.removeItem(at: pendingRecord)
        }
        try fileManager.moveItem(at: processingRecord, to: pendingRecord)
    }

    func completeJob(id: String) throws {
        try removeIfPresent(processingRecordURL(id: id))
        try removeIfPresent(pendingRecordURL(id: id))
        try removeIfPresent(payloadURL(id: id))
    }

    func discardStagedFile(_ staged: StagedShareFile) {
        try? fileManager.removeItem(at: staged.url)
    }

    func removeExpiredJobs(nowMs: Int64 = OutboundShareStore.nowMs) throws {
        var liveIDs = Set<String>()
        for directory in [pendingURL, processingURL] {
            for record in try recordURLs(in: directory) {
                guard let data = try? Data(contentsOf: record),
                      let job = try? decoder.decode(OutboundShareJob.self, from: data)
                else {
                    try? fileManager.removeItem(at: record)
                    continue
                }
                if nowMs - job.createdAtMs > Self.expirationMs {
                    try? fileManager.removeItem(at: record)
                    try? fileManager.removeItem(at: payloadURL(id: job.id))
                } else {
                    liveIDs.insert(job.id)
                }
            }
        }

        for payload in try fileManager.contentsOfDirectory(
            at: filesURL,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ) where payload.pathExtension == "payload" {
            let id = payload.deletingPathExtension().lastPathComponent
            guard !liveIDs.contains(id),
                  let modified = try? payload.resourceValues(
                    forKeys: [.contentModificationDateKey]
                  ).contentModificationDate,
                  nowMs - Int64(modified.timeIntervalSince1970 * 1_000) > Self.expirationMs
            else { continue }
            try? fileManager.removeItem(at: payload)
        }
    }

    static func sha256Upper(of fileURL: URL) throws -> String {
        guard let input = InputStream(url: fileURL) else {
            throw OutboundShareHandoffError.streamFailure
        }
        input.open()
        defer { input.close() }
        var hasher = SHA256()
        var buffer = [UInt8](repeating: 0, count: copyBufferBytes)

        while true {
            let count = input.read(&buffer, maxLength: buffer.count)
            if count < 0 { throw input.streamError ?? OutboundShareHandoffError.streamFailure }
            if count == 0 { break }
            hasher.update(data: Data(buffer[0..<count]))
        }
        return hasher.finalize().map { String(format: "%02X", $0) }.joined()
    }

    private func streamCopy(from sourceURL: URL, to temporaryURL: URL) throws -> Int64 {
        guard let input = InputStream(url: sourceURL),
              let output = OutputStream(url: temporaryURL, append: false)
        else { throw OutboundShareHandoffError.streamFailure }

        input.open()
        output.open()
        defer {
            input.close()
            output.close()
        }

        var total: Int64 = 0
        var buffer = [UInt8](repeating: 0, count: Self.copyBufferBytes)
        while true {
            let count = input.read(&buffer, maxLength: buffer.count)
            if count < 0 { throw input.streamError ?? OutboundShareHandoffError.streamFailure }
            if count == 0 { break }
            var offset = 0
            while offset < count {
                let written = buffer.withUnsafeBytes { rawBuffer in
                    output.write(
                        rawBuffer.baseAddress!.advanced(by: offset).assumingMemoryBound(to: UInt8.self),
                        maxLength: count - offset
                    )
                }
                if written <= 0 { throw output.streamError ?? OutboundShareHandoffError.streamFailure }
                offset += written
                total += Int64(written)
            }
        }
        return total
    }

    private func recoverAbandonedProcessingJobs(nowMs: Int64 = OutboundShareStore.nowMs) throws {
        for record in try recordURLs(in: processingURL) {
            guard let modified = try? record.resourceValues(
                forKeys: [.contentModificationDateKey]
            ).contentModificationDate,
                  nowMs - Int64(modified.timeIntervalSince1970 * 1_000) > Self.processingLeaseMs
            else { continue }
            let pendingRecord = pendingURL.appendingPathComponent(record.lastPathComponent)
            try? fileManager.removeItem(at: pendingRecord)
            try? fileManager.moveItem(at: record, to: pendingRecord)
        }
    }

    private func createDirectories() throws {
        for directory in [rootURL, filesURL, pendingURL, processingURL] {
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        }
    }

    private func fileSize(at url: URL) throws -> Int64 {
        let attributes = try fileManager.attributesOfItem(atPath: url.path)
        guard let number = attributes[.size] as? NSNumber else {
            throw OutboundShareHandoffError.invalidSource
        }
        return number.int64Value
    }

    private func protectFile(at url: URL) throws {
#if os(iOS)
        try fileManager.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: url.path
        )
#endif
    }

    private func recordURLs(in directory: URL) throws -> [URL] {
        try fileManager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ).filter { $0.pathExtension == "json" }
    }

    private func pendingRecordURL(id: String) -> URL {
        pendingURL.appendingPathComponent("\(id).json")
    }

    private func processingRecordURL(id: String) -> URL {
        processingURL.appendingPathComponent("\(id).json")
    }

    private func payloadURL(id: String) -> URL {
        filesURL.appendingPathComponent("\(id).payload")
    }

    private func removeIfPresent(_ url: URL) throws {
        if fileManager.fileExists(atPath: url.path) { try fileManager.removeItem(at: url) }
    }

    private static func safeDisplayName(_ raw: String) -> String {
        let name = URL(fileURLWithPath: raw).lastPathComponent
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty ? "file" : name
    }

    private static var nowMs: Int64 {
        Int64(Date().timeIntervalSince1970 * 1_000)
    }
}
