import Foundation

func trace(_ event: String, _ fields: [String: String] = [:]) {
    var row = fields
    row["event"] = event
    row["pid"] = String(ProcessInfo.processInfo.processIdentifier)
    row["ns"] = String(DispatchTime.now().uptimeNanoseconds)
    let data = try! JSONSerialization.data(withJSONObject: row, options: [.sortedKeys])
    FileHandle.standardOutput.write(data + Data([10]))
}
func objectID(_ object: AnyObject) -> String { String(describing: ObjectIdentifier(object)) }
enum SyncChannel { case lan }
struct LanServerProfile: Equatable, Sendable {
    let id: String; let name: String; let urls: [String]; let username: String; let allowInsecureTls: Bool
}
struct AppSettings { var syncChannel = SyncChannel.lan; var lanServers: [LanServerProfile] }
final class SettingsStore {
    var settings: AppSettings
    init(_ settings: AppSettings) { self.settings = settings }
    func loadAppSettings() -> AppSettings { settings }
}
enum LanServerCredentialStore {
    static func password(serverId: String) throws -> String? { "synthetic" }
}
final class HistoryLog {
    init(store: SettingsStore) {}
    func headHash() -> String? { nil }
}
struct Clipboard: Codable, Sendable {
    enum Kind: String, Codable { case text }
    var type = Kind.text
    var text = "synthetic"
    var contentId: String? = "synthetic"
    var hash: String? = nil
    var dataName: String? = nil
    var size: UInt64 = 0
    var hasData: Bool { dataName != nil }
}
struct DeviceClipboardSnapshot: Sendable { var clipboard: Clipboard; var payload: Data? }
struct ExtensionDeliveryReport {
    let entryId: String; let accepted: UInt64; let duplicate: UInt64
    let offline: UInt64; let errored: UInt64; let pending: UInt64
}
enum KeyboardRemoteChange { case snapshot(DeviceClipboardSnapshot) }
struct KeyboardSyncResult { let remoteChange: KeyboardRemoteChange?; let delivery: ExtensionDeliveryReport? }
@MainActor protocol KeyboardSyncTransport {}

@main struct Probe {
    @MainActor static func sync(
        _ transport: KeyboardLanSyncTransport, snapshot: DeviceClipboardSnapshot?, label: String = "sync"
    ) async {
        do {
            let result = try await transport.synchronize(snapshot)
            trace(label + ".return", [
                "cancelled": String(Task.isCancelled),
                "accepted": String(result.delivery?.accepted ?? 0),
                "errored": String(result.delivery?.errored ?? 0),
                "remote": String(result.remoteChange != nil)
            ])
        } catch {
            trace(label + ".error", [
                "error": String(describing: error),
                "cancellation": String(error is CancellationError),
                "cancelled": String(Task.isCancelled)
            ])
        }
    }

    @MainActor static func main() async {
        NSSetUncaughtExceptionHandler { exception in
            trace("objc.exception", ["name": exception.name.rawValue, "reason": exception.reason ?? "",
                "stack": exception.callStackSymbols.joined(separator: "\n")])
        }
        let args = CommandLine.arguments
        let mode = args[1], base = args[2], marker = args[3]
        let urls = mode == "single" ? [base + "/a"] : [base + "/a", base + "/b"]
        func profile(_ urls: [String]) -> LanServerProfile {
            LanServerProfile(id: "fixture", name: "fixture", urls: urls,
                username: "synthetic", allowInsecureTls: false)
        }
        let store = SettingsStore(AppSettings(lanServers: [profile(urls)]))
        if mode == "multi-server" {
            store.settings.lanServers.append(LanServerProfile(
                id: "other", name: "other", urls: [base + "/c"],
                username: "synthetic", allowInsecureTls: false))
        }
        let transport = KeyboardLanSyncTransport(store: store)
        trace("owner.show", ["owner": objectID(transport), "mode": mode])

        if mode == "admission-race" {
            let worker = Task { await sync(transport, snapshot: nil) }
            await Task.yield()
            transport.stop()
            await worker.value
        } else if mode == "pre-stop" {
            transport.stop()
            await sync(transport, snapshot: nil)
        } else if mode == "pre-cancel" {
            let worker = Task { await sync(transport, snapshot: nil) }
            worker.cancel()
            await worker.value
        } else if mode == "receive-sleep" {
            let receive = Task { try await transport.waitForRemoteChange(timeoutMs: 200) }
            await Task.yield()
            receive.cancel()
            transport.stop()
            do { _ = try await receive.value; trace("receive.return") }
            catch { trace("receive.error", ["cancellation": String(error is CancellationError)]) }
        } else {
            var clipboard = Clipboard()
            if mode == "payload-put" { clipboard.dataName = "fixture.bin" }
            let snapshot = ["pull", "payload-get"].contains(mode) ? nil :
                DeviceClipboardSnapshot(clipboard: clipboard, payload: clipboard.hasData ? Data([1, 2, 3]) : nil)
            let worker = Task { await sync(transport, snapshot: snapshot) }
            for _ in 0..<500 {
                if FileManager.default.fileExists(atPath: marker) { break }
                try? await Task.sleep(nanoseconds: 10_000_000)
            }
            guard FileManager.default.fileExists(atPath: marker) else {
                trace("harness.failure", ["reason": "request marker missing"]); exit(90)
            }
            trace("request.observed")
            if mode == "replace" {
                store.settings.lanServers = [profile([base + "/c"])]
                await sync(transport, snapshot: nil, label: "replacement")
            } else if !["healthy", "fallback", "auth"].contains(mode) {
                trace("owner.hide", ["owner": objectID(transport)])
                if mode != "stop" { trace("task.cancel"); worker.cancel() }
                if mode != "cancel" { transport.stop() }
            }
            await worker.value
            if mode == "reopen" {
                trace("owner.reuse.after.stop")
                await sync(transport, snapshot: nil, label: "reuse")
                let fresh = KeyboardLanSyncTransport(store: store)
                await sync(fresh, snapshot: nil, label: "fresh")
                fresh.stop()
            }
        }
        transport.stop()
        trace("harness.complete")
    }
}
