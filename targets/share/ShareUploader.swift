import Foundation
import OSLog

private let log = Logger(subsystem: "app.uniclipboard", category: "share")

/// Uploads a single `ShareItem` to the active SyncClipboard server.
/// Lives in the Share Extension target — owns the §3.5 file-first PUT
/// sequence (file bytes first, metadata second) so the main app's sync
/// engine, when it next ticks, sees a fully-consistent server state.
///
/// Writes `lastSyncedContentHash` to the App-Group `SettingsStore` after
/// a successful push. This is what keeps the main app's `SyncEngine` from
/// interpreting the just-pushed entry as "server has new content" and
/// echoing it back to the device pasteboard on next tick (which would
/// trigger iOS's "Allow Paste" prompt — see CLAUDE.md notes on engine
/// dedup against `lastSyncedContentHash`).
struct ShareUploader {
    let store: SettingsStore

    init(store: SettingsStore = SettingsStore()) {
        self.store = store
    }

    func upload(
        _ item: ShareItem,
        to server: ServerConfig,
        trustInsecureCert: Bool,
        network: NetworkContext
    ) async throws {
        let (entry, payload) = build(from: item)
        let clients = ShareClientPool(trustInsecureCert: trustInsecureCert)
        logUploadStart(item: item, entry: entry, server: server)

        try await ServerRouteExecutor(store: store).run(
            server: server,
            network: network,
            probe: { routed in
                let client = try await clients.client(for: routed)
                try await client.probeReachability()
            },
            operation: { routed in
                let client = try await clients.client(for: routed)
                if entry.hasData, let payload, let name = entry.dataName {
                    try await client.putFile(name: name, body: payload)
                    log.debug("upload: §3.5 file PUT done")
                    if let hash = entry.hash, !hash.isEmpty {
                        let profileId = HistoryRecord.profileId(type: entry.type, hash: hash)
                        _ = try? await PayloadCache.shared.write(profileId: profileId, bytes: payload)
                    }
                }
                try await client.putClipboard(entry)
            }
        )
        // Write the watermark only after a confirmed metadata PUT. A failed
        // route attempt may have uploaded bytes but did not publish metadata;
        // stamping before success can make the next sync skip real work.
        if let hash = entry.hash, !hash.isEmpty {
            store.saveLastSyncedHash(hash)
            // The pushed entry has no server identity yet — clear any stale
            // contentId watermark (kept atomic with the hash) so the main
            // app's SyncEngine doesn't dedup against a now-wrong identity. It
            // is re-learned on the next GET, where the server returns one.
            store.saveLastSyncedContentId(nil)
        }
        log.info("upload: metadata PUT done, watermark advanced")
        log.error("[share-route-v3] upload complete server=\(server.id, privacy: .public)")

        // Surface the push in the shared history so it shows up in the
        // main app's Home list. The app's SyncEngine won't log it on its own —
        // it sees the watermark we just wrote and treats the server entry as
        // already synced (skipping its own append). Routes to the shared
        // SQLite database (single source of truth) with a JSON-log fallback.
        HistoryLog(store: store).append(entry: entry, direction: .pushed)

        // Tell iOS Sharing Suggestions "the user just sent this to this
        // server" so next time the share sheet ranks the server's
        // contact tile higher. Best-effort: failures are swallowed inside.
        await ShareIntentDonation.donateSend(to: server, summary: item.displayName)
    }

    private func build(from item: ShareItem) -> (clipboard: Clipboard, payload: Data?) {
        switch item {
        case .text(let text):
            return Clipboard.publishText(text)
        case .image(let bytes, let ext):
            return Clipboard.publishImage(bytes: bytes, ext: ext)
        case .file(let name, let bytes):
            return Clipboard.publishFile(name: name, bytes: bytes)
        }
    }
}

private func logUploadStart(item: ShareItem, entry: Clipboard, server: ServerConfig) {
    let urlList = server.urls.joined(separator: " | ")
    log.info(
        """
        upload: start \(item.kindLabel, privacy: .public) \
        bytes=\(item.byteCount, privacy: .public) hasData=\(entry.hasData, privacy: .public)
        """
    )
    log.error(
        """
        [share-route-v3] upload start server=\(server.id, privacy: .public) \
        urlCount=\(server.urls.count, privacy: .public) urls=\(urlList, privacy: .public) \
        hasData=\(entry.hasData, privacy: .public)
        """
    )
}

private actor ShareClientPool {
    private let trustInsecureCert: Bool
    private var clients: [String: SyncClipboardClient] = [:]

    init(trustInsecureCert: Bool) {
        self.trustInsecureCert = trustInsecureCert
    }

    func client(for server: ServerConfig) throws -> SyncClipboardClient {
        if let client = clients[server.url] {
            return client
        }
        let client = try SyncClipboardClient(
            server: server,
            trustInsecureCert: trustInsecureCert
        )
        clients[server.url] = client
        return client
    }
}
