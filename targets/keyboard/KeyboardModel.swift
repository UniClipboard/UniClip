import Combine
import Foundation
import UIKit
import ImageIO
import OSLog
internal import UcEngineCore

private let log = Logger(subsystem: "app.uniclipboard.keyboard", category: "sync")

/// Observable state + sync logic backing the UniClip keyboard. Owned by
/// `KeyboardViewController`; the UIKit `KeyboardRootView` observes its narrow
/// presentation objects and calls its actions.
///
/// The screen is a compact clipboard-history browser, not a QWERTY: a
/// horizontally-scrolling row of cards distilled from the App Group history
/// log (`SettingsStore.loadHistory()`), filterable by 最近 / 文本 / 图片.
/// Tapping a card inserts its text inline (uplink-free) or fetches + copies
/// an image to the pasteboard. A background sync pass pushes anything newly
/// copied on the device and receives the space's latest entry so the row stays live.
///
/// MainActor-isolated (the target's default isolation). Pasteboard reads run
/// on main; network work hops off via `await` on the non-isolated
/// P2P work runs outside the main actor through the extension engine.
///
/// Uses `ObservableObject` + `@Published` rather than the iOS 17 `@Observable`
/// macro so the extension's deployment target can stay at iOS 16 — the
/// Observation framework is iOS 17+ and would otherwise gate the whole
/// keyboard off iOS 16 devices.
@MainActor
// The sync state machine and its presentation-ready card mapping intentionally
// share one actor-isolated owner; splitting it would duplicate mutable state.
// swiftlint:disable:next type_body_length
final class KeyboardModel: ObservableObject {

    // MARK: - Top-level gate

    /// What the content area should render *before* we even look at cards:
    /// Full Access is required before the extension can read the pasteboard.
    enum Gate: Equatable {
        case ok
        case needsFullAccess
    }

    /// Result of the uplink half of a sync pass. No longer shown as text —
    /// kept so a pass can tell whether it actually pushed (drives `syncFlash`).
    enum PushStatus: Equatable {
        case none                 // nothing on the device pasteboard
        case pushed(String)       // pushed; payload is a short summary
        case failed(String)
    }

    /// Transient sync-outcome badge shown *on the refresh button*: a brief
    /// green ✓ after a pass that actually moved data, a brief amber ! after a
    /// failed pull. Replaces the old verbose "已发送本机内容…" status text.
    enum SyncFlash: Equatable { case success, failure }

    /// One card in the horizontal row — a `ClipboardHistoryItem` distilled
    /// into display-ready fields. Built from history *metadata*: text cards
    /// carry their value inline (ready to insert), image cards defer both the
    /// thumbnail and the full-payload fetch to lazy network calls so a row of
    /// cards never pulls multi-MB blobs into the keyboard's tight memory
    /// budget up front. The underlying `entry` is retained for the tap action
    /// and the thumbnail fetch.
    struct Card: Identifiable, Equatable {
        enum Kind: Equatable { case text, link, image }

        let id: UUID            // the history item's stable id
        let kind: Kind
        let entry: Clipboard    // underlying snapshot — drives action + thumbnail
        let title: String       // text snippet / "图片"
        let subtitle: String?   // URL host for links, else nil
        let time: String        // relative-short timestamp ("9:41" style)
        let sizeText: String?   // "128 字" / "1.2 MB"

        /// Tabs this card belongs to. `链接` rides in the 文本 tab.
        var isText: Bool { kind == .text || kind == .link }
        var isImage: Bool { kind == .image }

        static func == (lhs: Card, rhs: Card) -> Bool {
            lhs.id == rhs.id
                && lhs.kind == rhs.kind
                && lhs.entry == rhs.entry
                && lhs.title == rhs.title
                && lhs.subtitle == rhs.subtitle
                && lhs.sizeText == rhs.sizeText
        }
    }

    // MARK: - Published state

    @Published var hasFullAccess: Bool = false
    @Published var needsInputModeSwitchKey: Bool = true

    /// Key-feedback prefs, mirrored from `AppSettings` (App Group). Read
    /// once on appear and re-read on each sync pass so a change made in the
    /// main app takes effect the next time the keyboard opens. Default true
    /// so a fresh install feels like a stock keyboard.
    private(set) var soundFeedback = true
    private(set) var hapticFeedback = true
    @Published private(set) var localization = ExtensionLocalization()

    @Published private(set) var gate: Gate = .ok
    /// Set on a failed pull / tap-fetch. Rendered as an inline chip (cards
    /// present) or a full hint + retry (no cards).
    @Published private(set) var lastError: String?
    @Published private(set) var cards: [Card] = []
    private(set) var pushStatus: PushStatus = .none

    /// The card whose deferred payload (long text / image) is being fetched,
    /// so just that card can show a spinner.
    @Published private(set) var actingCardID: UUID?
    /// Briefly set right after an insert/copy so the tapped card can flash a
    /// "已插入 / 已复制" confirmation without a separate state machine.
    @Published private(set) var actedCardID: UUID?

    /// Context-appropriate label for the Return key, derived from the host
    /// field's `returnKeyType` (发送 / 搜索 / …). `nil` ⇒ render the ↵ glyph.
    /// Set by the controller; a custom keyboard can read the type but can
    /// only ever *insert a newline*, which most single-line fields submit on.
    @Published private(set) var returnKeyTitle: String?
    private var returnKeyType: UIReturnKeyType?

    @Published private(set) var isSyncing = false
    @Published private(set) var syncFlash: SyncFlash?

    // MARK: - UI callbacks (wired by the controller)

    var insertText: (String) -> Void = { _ in }
    var deleteBackward: () -> Void = {}
    var advanceInputMode: () -> Void = {}
    var dismiss: () -> Void = {}
    var openSettings: () -> Void = {}
    /// Plays the system key-click sound. Wired by the controller to
    /// `UIDevice.current.playInputClick()` — which only fires when the
    /// input view adopts `UIInputViewAudioFeedback` AND the user has
    /// 键盘点击音 enabled, so the model never has to check that itself.
    var playInputClick: () -> Void = {}

    /// Reused light-impact generator for key haptics. Kept warm via
    /// `prepare()` so a press fires with minimal latency.
    private let impactGenerator = UIImpactFeedbackGenerator(style: .light)

    /// One App-Group store for the keyboard's lifetime — reused by the live
    /// poll (~1.2s) and the sync paths so we don't re-run the store's
    /// init-time migrations on every tick.
    private let store = SettingsStore()

    /// History reads/writes route through the shared App Group SQLite
    /// database (single source of truth with the main app — deletes there
    /// disappear here, tombstones block pull-resurrection), falling back to
    /// the legacy JSON log until the app's first launch creates the DB.
    /// `lazy` (not `let`) so a keyboard session that starts before the app
    /// ever ran still probes the DB at first use. Not `@Published` — it's
    /// internal machinery the views never observe.
    private lazy var history = HistoryLog(store: store)

    /// Decoded thumbnails keyed by image content hash. Bounded by NSCache's
    /// own eviction so a long-lived keyboard session can't grow unbounded.
    private let thumbnailCache = NSCache<NSString, UIImage>()

    /// Monotonic token used to keep one task's completion paired with the run
    /// that started it. The event gate serializes all sync sources and retains
    /// at most one follow-up while the current bounded session is active.
    private var syncGeneration = 0
    private var syncTask: Task<Void, Never>?
    private var syncEventGate = ExtensionSyncEventGate()
    private var p2pClient: ExtensionP2pClient?
    private var p2pSessionController: ExtensionP2pClientController?
    private var p2pReceiveTask: Task<Void, Never>?
    private var p2pReceiveIdlePolls = 0
    private var clipboardRevisionTracker = ExtensionClipboardRevisionTracker()
    private var isVisible = false
    private var flashTask: Task<Void, Never>?
    /// Polls `UIPasteboard.changeCount` while the keyboard is on screen so a
    /// copy made *with the keyboard already open* auto-syncs without a manual
    /// refresh tap. Reading `changeCount` is free and never prompts.
    private var pollTask: Task<Void, Never>?

    // MARK: - Lifecycle

    /// Restores all disk-backed presentation state before SwiftUI evaluates
    /// the keyboard for the first time. iOS may recreate the input controller
    /// after a Copy action even though the extension process stays alive; the
    /// new controller must not render an empty/restricted frame first.
    func prepareForFirstPresentation(
        fullAccess: Bool,
        needsInputModeSwitchKey: Bool,
        returnKeyType: UIReturnKeyType?
    ) {
        loadFeedbackPrefs()
        self.needsInputModeSwitchKey = needsInputModeSwitchKey
        hasFullAccess = fullAccess
        setReturnKeyType(returnKeyType)
        if fullAccess {
            publishGate(.ok)
            reloadCards()
        } else {
            publishGate(.needsFullAccess)
        }
        KeyboardDiagnostics.shared.record("model.prepare", fields: [
            "fullAccess": String(fullAccess),
            "needsInputModeSwitchKey": String(needsInputModeSwitchKey),
            "cardCount": String(cards.count),
        ])
    }

    /// Called from `viewDidAppear`. Gates on Full Access, shows cached
    /// history instantly, runs an initial sync pass, and starts watching the
    /// pasteboard for changes while open.
    func onAppear() {
        isVisible = true
        let storedRevision = store.loadLastSyncedChangeCount()
        clipboardRevisionTracker = ExtensionClipboardRevisionTracker(
            lastHandledRevision: storedRevision
        )
        KeyboardDiagnostics.shared.record("model.appear", fields: [
            "fullAccess": String(hasFullAccess),
            "pasteboardRevision": String(UIPasteboard.general.changeCount),
            "storedRevision": storedRevision.map(String.init) ?? "nil",
        ])
        // Load feedback prefs first — the space/⌫/return keys work (and so
        // should honor the click/haptic toggles) even before Full Access,
        // i.e. before the gate below short-circuits.
        loadFeedbackPrefs()
        impactGenerator.prepare()
        guard hasFullAccess else {
            publishGate(.needsFullAccess)
            return
        }
        reloadCards()        // instant, offline — render before the network round-trip
        requestSync(.appeared)
        startMonitoring()
    }

    /// Mirror the keyboard-feedback toggles out of the App Group settings.
    /// Cheap (one `UserDefaults` data decode); called on appear and on each
    /// sync pass so a change in the main app is picked up promptly.
    private func loadFeedbackPrefs() {
        applyPreferences(store.loadAppSettings())
    }

    private func applyPreferences(_ settings: AppSettings) {
        soundFeedback = settings.keyboardSoundFeedback
        hapticFeedback = settings.keyboardHapticFeedback
        let nextLocalization = ExtensionLocalization(preference: settings.language)
        guard nextLocalization != localization else { return }
        localization = nextLocalization
        updateReturnKeyTitle()
        if !cards.isEmpty { reloadCards() }
    }

    /// Fire key feedback for a button/key tap: the system click sound and a
    /// light haptic, each gated by the user's prefs. `haptic: false` suppresses
    /// only the haptic (used by backspace auto-repeat, where a buzz on every
    /// repeat tick would be unpleasant while the click still reads as typing).
    func keyFeedback(haptic: Bool = true) {
        if soundFeedback { playInputClick() }
        if haptic, hapticFeedback {
            impactGenerator.impactOccurred()
            impactGenerator.prepare()   // re-arm for the next press
        }
    }

    /// Queue a sync for one concrete event source. If a bounded session is
    /// already active, the gate coalesces all new events into one prioritized
    /// follow-up instead of cancelling native work or running sessions beside
    /// each other.
    func requestSync(_ trigger: ExtensionSyncTrigger) {
        guard hasFullAccess else {
            recordSyncRequest(trigger, outcome: "ignored_no_full_access")
            publishGate(.needsFullAccess)
            return
        }
        guard isVisible else {
            recordSyncRequest(trigger, outcome: "ignored_not_visible")
            return
        }
        guard let accepted = syncEventGate.request(trigger) else {
            recordSyncRequest(trigger, outcome: "merged")
            return
        }
        recordSyncRequest(trigger, outcome: "accepted")
        startSync(accepted)
    }

    private func recordSyncRequest(_ trigger: ExtensionSyncTrigger, outcome: String) {
        KeyboardDiagnostics.shared.record("sync.request", fields: [
            "trigger": trigger.diagnosticName,
            "outcome": outcome,
            "visible": String(isVisible),
            "fullAccess": String(hasFullAccess),
            "generation": String(syncGeneration),
        ])
    }

    private func startSync(_ trigger: ExtensionSyncTrigger) {
        syncGeneration += 1
        let gen = syncGeneration
        KeyboardDiagnostics.shared.record("sync.start", fields: [
            "trigger": trigger.diagnosticName,
            "generation": String(gen),
        ])
        setSyncing(trigger.showsSyncProgress)
        syncTask = Task { [weak self] in
            guard let self else { return }
            await self.sync(
                force: trigger == .manual,
                publishHistoryChanges: trigger.shouldPublishHistoryImmediately,
                showSyncFeedback: trigger.showsSyncProgress
            )
            guard gen == self.syncGeneration else {
                KeyboardDiagnostics.shared.record("sync.finish", fields: [
                    "generation": String(gen),
                    "outcome": "stale_or_cancelled",
                ])
                return
            }
            self.syncTask = nil
            if let pending = self.syncEventGate.finish(), self.isVisible {
                KeyboardDiagnostics.shared.record("sync.finish", fields: [
                    "generation": String(gen),
                    "outcome": "follow_up",
                    "nextTrigger": pending.diagnosticName,
                ])
                self.startSync(pending)
            } else {
                KeyboardDiagnostics.shared.record("sync.finish", fields: [
                    "generation": String(gen),
                    "outcome": "idle",
                    "visible": String(self.isVisible),
                ])
                self.setSyncing(false)
            }
        }
    }

    /// Begin polling the pasteboard `changeCount` (~1.2s) while the keyboard
    /// is visible. When it advances past what we last synced — i.e. the user
    /// copied something new with the keyboard already up — fire an automatic
    /// sync. Idempotent; `stopMonitoring()` tears it down on disappear.
    func startMonitoring() {
        guard hasFullAccess else {
            KeyboardDiagnostics.shared.record("clipboard.monitor", fields: ["outcome": "not_started"])
            return
        }
        KeyboardDiagnostics.shared.record("clipboard.monitor", fields: ["outcome": "started"])
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_200_000_000)
                if Task.isCancelled { return }
                self?.pollTick()
            }
        }
    }

    func stopMonitoring() {
        KeyboardDiagnostics.shared.record("model.stop", fields: [
            "generation": String(syncGeneration),
            "hadClient": String(p2pClient != nil),
            "hadSyncTask": String(syncTask != nil),
        ])
        isVisible = false
        pollTask?.cancel()
        pollTask = nil
        syncGeneration += 1
        syncTask?.cancel()
        syncTask = nil
        syncEventGate.cancelAll()
        setSyncing(false)
        stopP2pSession()
    }

    /// One poll iteration compares only the pasteboard revision. It never runs
    /// a periodic network pass: unchanged or synchronized writes are ignored.
    private func pollTick() {
        let cc = UIPasteboard.general.changeCount
        let changed = clipboardRevisionTracker.hasUnprocessedChange(cc)
        KeyboardDiagnostics.shared.record("clipboard.poll", fields: [
            "revision": String(cc),
            "storedRevision": store.loadLastSyncedChangeCount().map(String.init) ?? "nil",
            "changed": String(changed),
            "fullAccess": String(hasFullAccess),
            "gate": gate.diagnosticName,
            "visible": String(isVisible),
        ])
        guard hasFullAccess, gate == .ok, isVisible else { return }
        if changed {
            requestSync(.localClipboardChanged)
        }
    }

    // MARK: - Return key

    /// Record the host field's Return-key intent so the key can label itself
    /// (发送 / 搜索 / …) like the system keyboard. Called by the controller on
    /// appear / when the input context changes.
    func setReturnKeyType(_ type: UIReturnKeyType?) {
        returnKeyType = type
        updateReturnKeyTitle()
    }

    private func updateReturnKeyTitle() {
        switch returnKeyType ?? .default {
        case .go: returnKeyTitle = localization.string("前往")
        case .search, .google, .yahoo: returnKeyTitle = localization.string("搜索")
        case .send: returnKeyTitle = localization.string("发送")
        case .done: returnKeyTitle = localization.string("完成")
        case .next: returnKeyTitle = localization.string("下一项")
        case .continue: returnKeyTitle = localization.string("继续")
        case .join: returnKeyTitle = localization.string("加入")
        default: returnKeyTitle = nil   // .default → ↵ glyph
        }
    }

    // MARK: - Sync

    private func sync(
        force: Bool,
        publishHistoryChanges: Bool,
        showSyncFeedback: Bool
    ) async {
        let settings = store.loadAppSettings()
        applyPreferences(settings)

        // Read the pasteboard once — the content read triggers iOS's
        // "允许粘贴" prompt, so we gate on changeCount and share the
        // snapshot between the local-history and P2P paths.
        let cc = UIPasteboard.general.changeCount
        let storedCC = store.loadLastSyncedChangeCount()
        let ccChanged = cc != storedCC
        let snap: DeviceClipboardSnapshot? = (ccChanged || force) ? PasteboardReader.snapshot() : nil
        KeyboardDiagnostics.shared.record("sync.snapshot", fields: [
            "revision": String(cc),
            "storedRevision": storedCC.map(String.init) ?? "nil",
            "changed": String(ccChanged),
            "force": String(force),
            "kind": snap?.clipboard.type.rawValue ?? "none",
            "declaredBytes": snap?.clipboard.size.map(String.init) ?? "nil",
            "payloadBytes": snap?.payload.map { String($0.count) } ?? "0",
            "hasPayload": String(snap?.payload != nil),
        ])
        log.info("sync: cc=\(cc) stored=\(storedCC ?? -1) ccChanged=\(ccChanged) force=\(force) snap=\(snap != nil) snapHash=\(snap?.clipboard.hash ?? "nil")")

        recordLocalClipboardIfNew(snap)
        if let snap, let payload = snap.payload, let hash = snap.clipboard.hash {
            store.saveImageData(hash: hash, data: payload)
        }
        if publishHistoryChanges { reloadCards() }
        publishGate(.ok)
        await syncP2pSnapshot(
            snap,
            changeCount: cc,
            force: force,
            publishHistoryChanges: publishHistoryChanges,
            showSyncFeedback: showSyncFeedback
        )
    }

    /// Runs one bounded send-and-receive session against the App Group-backed store.
    private func syncP2pSnapshot(
        _ snapshot: DeviceClipboardSnapshot?,
        changeCount: Int,
        force: Bool,
        publishHistoryChanges: Bool,
        showSyncFeedback: Bool
    ) async {
        clipboardRevisionTracker.markProcessing(changeCount)
        defer { clipboardRevisionTracker.finishProcessing(changeCount) }
        do {
            let client = try await p2pSession()
            let result = try await ExtensionSyncExecutor.run {
                try ExtensionSyncRouter.synchronizeKeyboardSnapshot(snapshot, using: client)
            }
            guard isVisible, !Task.isCancelled else { return }
            var deliveryFields = [
                "hasSnapshot": String(snapshot != nil),
                "receivedRemote": String(result.receivedRemoteChange),
                "state": result.delivery?.state.diagnosticName ?? "none",
                "refreshTotal": String(result.peerRefresh.total),
                "refreshOnline": String(result.peerRefresh.online),
                "refreshOffline": String(result.peerRefresh.offline),
                "refreshErrors": String(result.peerRefresh.errors),
            ]
            if let delivery = result.delivery {
                deliveryFields["accepted"] = String(delivery.accepted)
                deliveryFields["duplicate"] = String(delivery.duplicate)
                deliveryFields["offline"] = String(delivery.offline)
                deliveryFields["errored"] = String(delivery.errored)
                deliveryFields["pending"] = String(delivery.pending)
            }
            KeyboardDiagnostics.shared.record("p2p.send.result", fields: deliveryFields)
            let currentChangeCount = result.receivedRemoteChange
                ? UIPasteboard.general.changeCount
                : changeCount
            recordHandledClipboardRevision(currentChangeCount)

            if let snapshot, let delivery = result.delivery {
                switch delivery.state {
                case .delivered:
                    history.append(entry: snapshot.clipboard, direction: .pushed)
                    pushStatus = .pushed(summary(for: snapshot.clipboard))
                    publishLastError(nil)
                case .partial:
                    let message = localization.string("部分设备尚未收到")
                    pushStatus = .failed(message)
                    publishLastError(message)
                case .offline:
                    let message = localization.string("设备离线")
                    pushStatus = .failed(message)
                    publishLastError(message)
                case .pending:
                    let message = localization.string("等待发送")
                    pushStatus = .failed(message)
                    publishLastError(message)
                case .failed:
                    let message = localization.string("发送失败")
                    pushStatus = .failed(message)
                    publishLastError(message)
                }
            } else {
                pushStatus = .none
            }

            let deliveryFailed = result.delivery.map { $0.state != .delivered } ?? false
            if result.receivedRemoteChange {
                publishP2pRemoteChange(clearError: !deliveryFailed)
            } else if publishHistoryChanges {
                reloadCards()
            }

            let deliverySucceeded = result.delivery?.state == .delivered
            if showSyncFeedback {
                if deliveryFailed {
                    flashSync(.failure)
                } else if force || deliverySucceeded || result.receivedRemoteChange {
                    flashSync(.success)
                }
            }
        } catch {
            guard isVisible, !Task.isCancelled else { return }
            KeyboardDiagnostics.shared.record("p2p.send.result", fields: [
                "outcome": "failure",
                "errorType": String(reflecting: type(of: error)),
            ])
            recordHandledClipboardRevision(changeCount)
            pushStatus = .failed(message(for: error))
            publishLastError(message(for: error))
            if showSyncFeedback { flashSync(.failure) }
        }
    }

    private func p2pSession() async throws -> ExtensionP2pClient {
        if let p2pClient {
            KeyboardDiagnostics.shared.record("p2p.connect.reuse")
            return p2pClient
        }
        let started = DispatchTime.now().uptimeNanoseconds
        KeyboardDiagnostics.shared.record("p2p.connect.start")
        let controller = try ExtensionP2pClientController()
        p2pSessionController = controller
        do {
            let client = try await ExtensionSyncExecutor.run {
                try ExtensionP2pClient(controller: controller)
            }
            guard isVisible,
                  !Task.isCancelled,
                  p2pSessionController === controller else {
                client.shutdown()
                throw CancellationError()
            }
            p2pClient = client
            KeyboardDiagnostics.shared.record("p2p.connect.success", fields: [
                "durationMs": String(KeyboardDiagnostics.elapsedMilliseconds(since: started)),
            ])
            startP2pReceiving(client)
            return client
        } catch {
            if p2pSessionController === controller {
                p2pSessionController = nil
            }
            controller.stopForSuspension()
            KeyboardDiagnostics.shared.record("p2p.connect.failure", fields: [
                "durationMs": String(KeyboardDiagnostics.elapsedMilliseconds(since: started)),
                "errorType": String(reflecting: type(of: error)),
            ])
            throw error
        }
    }

    private func startP2pReceiving(_ client: ExtensionP2pClient) {
        p2pReceiveTask?.cancel()
        p2pReceiveIdlePolls = 0
        KeyboardDiagnostics.shared.record("p2p.receive.wait", fields: ["phase": "started"])
        p2pReceiveTask = Task { [weak self, client] in
            while !Task.isCancelled {
                do {
                    let received = try await ExtensionSyncExecutor.run {
                        try client.waitForRemoteChange(timeoutMs: 500)
                    }
                    guard !Task.isCancelled, let self, self.isVisible else { return }
                    if received {
                        KeyboardDiagnostics.shared.record("p2p.receive.change")
                        self.p2pReceiveIdlePolls = 0
                        self.publishP2pRemoteChange(clearError: true)
                    } else {
                        self.p2pReceiveIdlePolls += 1
                        if self.p2pReceiveIdlePolls >= 20 {
                            KeyboardDiagnostics.shared.record("p2p.receive.wait", fields: [
                                "phase": "idle_summary",
                                "polls": String(self.p2pReceiveIdlePolls),
                            ])
                            self.p2pReceiveIdlePolls = 0
                        }
                    }
                    await Task.yield()
                } catch {
                    guard !Task.isCancelled, let self, self.isVisible else { return }
                    KeyboardDiagnostics.shared.record("p2p.receive.failure", fields: [
                        "errorType": String(reflecting: type(of: error)),
                    ])
                    self.publishLastError(self.message(for: error))
                    return
                }
            }
        }
    }

    private func stopP2pSession() {
        p2pReceiveTask?.cancel()
        p2pReceiveTask = nil
        p2pReceiveIdlePolls = 0
        let client = p2pClient
        let controller = p2pSessionController
        p2pClient = nil
        p2pSessionController = nil
        guard client != nil || controller != nil else {
            KeyboardDiagnostics.shared.record("p2p.close.start", fields: ["outcome": "no_client"])
            return
        }
        KeyboardDiagnostics.shared.record("p2p.close.start", fields: ["outcome": "suspending"])
        if let client {
            client.shutdown()
        } else {
            controller?.stopForSuspension()
        }
        KeyboardDiagnostics.shared.record("p2p.close.finish")
    }

    private func publishP2pRemoteChange(clearError: Bool) {
        let revision = UIPasteboard.general.changeCount
        recordHandledClipboardRevision(revision)
        guard let remote = PasteboardReader.snapshot() else {
            KeyboardDiagnostics.shared.record("p2p.receive.change", fields: [
                "outcome": "snapshot_missing",
                "revision": String(revision),
            ])
            return
        }
        KeyboardDiagnostics.shared.record("p2p.receive.change", fields: [
            "outcome": "published",
            "revision": String(revision),
            "kind": remote.clipboard.type.rawValue,
            "declaredBytes": remote.clipboard.size.map(String.init) ?? "nil",
            "payloadBytes": remote.payload.map { String($0.count) } ?? "0",
        ])
        if let payload = remote.payload, let hash = remote.clipboard.hash {
            store.saveImageData(hash: hash, data: payload)
        }
        history.append(entry: remote.clipboard, direction: .pulled)
        if clearError { publishLastError(nil) }
        reloadCards()
    }

    /// Record the device pasteboard to the shared history log if it carries
    /// content we haven't seen. Does NOT stamp the changeCount watermark —
    /// that's deferred to pushDeviceClipboardIfNew so the push path isn't
    /// blocked by the record path having already stamped it.
    private func recordLocalClipboardIfNew(_ snap: DeviceClipboardSnapshot?) {
        guard let snap, let hash = snap.clipboard.hash?.uppercased() else { return }
        if history.headHash()?.uppercased() == hash { return }
        history.append(entry: snap.clipboard, direction: .local)
    }

    /// Show a brief outcome badge on the refresh button, then clear it.
    /// Success lingers ~1.4s; failure a touch longer so it's noticed.
    private func flashSync(_ outcome: SyncFlash) {
        setSyncFlash(outcome)
        flashTask?.cancel()
        flashTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(outcome == .success ? 1.4 : 2.0))
            if !Task.isCancelled { self?.setSyncFlash(nil) }
        }
    }

    private func setSyncing(_ next: Bool) {
        guard isSyncing != next else { return }
        isSyncing = next
    }

    private func setSyncFlash(_ next: SyncFlash?) {
        guard syncFlash != next else { return }
        syncFlash = next
    }

    private func publishGate(_ next: Gate) {
        guard gate != next else { return }
        gate = next
    }

    private func publishLastError(_ next: String?) {
        guard lastError != next else { return }
        lastError = next
    }

    private func recordHandledClipboardRevision(_ revision: Int) {
        clipboardRevisionTracker.markSynchronizedWrite(revision)
        store.saveLastSyncedChangeCount(revision)
        KeyboardDiagnostics.shared.record("clipboard.revision.handled", fields: [
            "revision": String(revision),
        ])
    }

    /// Rebuild the card row from the on-disk history log (newest-first,
    /// text + image only). Publishing is skipped when the visible result did
    /// not change so UIKit does not reload the card collection after a no-op sync.
    private func reloadCards() {
        let nextCards = history.loadRecent(limit: 100)
            .compactMap { card(from: $0) }
        let changed = nextCards != cards
        let difference = cardDifference(from: cards, to: nextCards)
        KeyboardDiagnostics.shared.record("history.reload", fields: [
            "oldCount": String(cards.count),
            "newCount": String(nextCards.count),
            "changed": String(changed),
            "firstID": nextCards.first?.id.uuidString ?? "nil",
            "mismatchIndex": difference.index,
            "changedFields": difference.fields,
        ])
        guard nextCards != cards else { return }
        cards = nextCards
    }

    private func cardDifference(from current: [Card], to next: [Card]) -> (index: String, fields: String) {
        guard current.count == next.count else { return ("count", "count") }
        guard let index = current.indices.first(where: { current[$0] != next[$0] }) else {
            return ("none", "none")
        }
        let old = current[index]
        let new = next[index]
        var fields: [String] = []
        if old.id != new.id { fields.append("id") }
        if old.kind != new.kind { fields.append("kind") }
        if old.entry.type != new.entry.type { fields.append("entryType") }
        if old.entry.hash != new.entry.hash { fields.append("entryHash") }
        if old.entry.text != new.entry.text { fields.append("entryText") }
        if old.entry.hasData != new.entry.hasData { fields.append("entryHasData") }
        if old.entry.dataName != new.entry.dataName { fields.append("entryDataName") }
        if old.entry.size != new.entry.size { fields.append("entrySize") }
        if old.entry.contentId != new.entry.contentId { fields.append("entryContentId") }
        if old.title != new.title { fields.append("title") }
        if old.subtitle != new.subtitle { fields.append("subtitle") }
        if old.time != new.time { fields.append("time") }
        if old.sizeText != new.sizeText { fields.append("sizeText") }
        return (String(index), fields.joined(separator: ","))
    }

    private func card(from item: ClipboardHistoryItem) -> Card? {
        let entry = item.entry
        switch entry.type {
        case .text:
            let isLink = Self.looksLikeURL(entry.text)
            return Card(
                id: item.id,
                kind: isLink ? .link : .text,
                entry: entry,
                title: Self.snippet(entry.text),
                subtitle: isLink ? Self.urlHost(entry.text) : nil,
                time: relativeShort(item.timestamp),
                sizeText: textCountText(entry.size ?? entry.text.count)
            )
        case .image:
            guard entry.hasData, let name = entry.dataName else { return nil }
            let rawExt = (name as NSString).pathExtension
            let ext = rawExt.isEmpty ? "png" : rawExt.lowercased()
            return Card(
                id: item.id,
                kind: .image,
                entry: entry,
                title: localization.string("图片"),
                subtitle: ext.uppercased(),
                time: relativeShort(item.timestamp),
                sizeText: imageSizeText(byteCount: entry.size ?? 0)
            )
        case .file, .group:
            return nil
        }
    }

    // MARK: - Card actions

    /// Act on a tapped card: insert text inline, or copy a cached image to
    /// the system pasteboard (a text field can't host an image inline).
    func activate(_ card: Card) {
        guard actingCardID == nil else { return }
        keyFeedback()
        let entry = card.entry
        switch card.kind {
        case .text, .link:
            if entry.hasData {
                publishPayloadUnavailable()
            } else {
                insertText(entry.text)
                flashActed(card.id)
            }
        case .image:
            guard let name = entry.dataName else { return }
            let rawExt = (name as NSString).pathExtension
            let ext = rawExt.isEmpty ? "png" : rawExt.lowercased()
            if let hash = entry.hash, let local = store.loadImageData(hash: hash), !local.isEmpty {
                copyImageToPasteboard(local, ext: ext, card: card)
            } else {
                publishPayloadUnavailable()
            }
        }
    }

    /// Write image bytes to `UIPasteboard.general`, cache them under their
    /// content hash (so the app's offline preview finds them), surface the
    /// card at the history head, and send it through P2P. Reading back our own
    /// just-written pasteboard never prompts.
    private func copyImageToPasteboard(_ data: Data, ext: String, card: Card) {
        UIPasteboard.general.setData(data, forPasteboardType: PasteboardReader.uti(forExt: ext))
        store.saveImageData(hash: Clipboard.computeBytesHash(data), data: data)
        history.touch(hash: card.entry.hash, legacyID: card.id)
        flashActed(card.id)
        requestSync(.localClipboardChanged)
    }

    private func publishPayloadUnavailable() {
        publishLastError(localization.string("内容未保存在本机"))
        flashSync(.failure)
    }

    private func flashActed(_ id: UUID) {
        actedCardID = id
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            if self?.actedCardID == id { self?.actedCardID = nil }
        }
    }

    // MARK: - Thumbnails

    /// Lazily fetch + downsample an image card's thumbnail. Cached by content
    /// hash; bounded by a per-image size guard so a huge original never blows
    /// the keyboard's memory budget (those fall back to a placeholder). The
    /// downsample decodes straight to ~`maxPixel` via ImageIO — the full
    /// bitmap is never realized.
    func thumbnail(for card: Card, maxPixel: CGFloat = 220) async -> UIImage? {
        guard card.kind == .image,
              let hash = card.entry.hash else { return nil }
        let key = hash as NSString
        if let cached = thumbnailCache.object(forKey: key) { return cached }
        if let size = card.entry.size, size > 8 * 1024 * 1024 { return nil }

        guard let data = store.loadImageData(hash: hash) else { return nil }
        guard let img = Self.downsample(data: data, maxPixel: maxPixel) else { return nil }
        thumbnailCache.setObject(img, forKey: key)
        return img
    }

    /// Decode `data` to a thumbnail no larger than `maxPixel` on its long
    /// edge, honoring EXIF orientation. ImageIO decodes directly to the
    /// requested size — the full-resolution bitmap is never allocated.
    private static func downsample(data: Data, maxPixel: CGFloat) -> UIImage? {
        let srcOpts = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let src = CGImageSourceCreateWithData(data as CFData, srcOpts) else { return nil }
        let thumbOpts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, thumbOpts as CFDictionary) else {
            return nil
        }
        return UIImage(cgImage: cg)
    }

    // MARK: - Link detection

    /// True for a trimmed, whitespace-free http(s) URL with a host. Kept
    /// strict so prose with a stray "www." doesn't masquerade as a link.
    private static func looksLikeURL(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              trimmed.count <= 2048,
              !trimmed.contains(where: \.isWhitespace) else { return false }
        guard let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              url.host?.isEmpty == false else { return false }
        return true
    }

    private static func urlHost(_ text: String) -> String? {
        URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines))?.host
    }

    // MARK: - Formatting helpers

    private static func snippet(_ text: String, limit: Int = 120) -> String {
        let collapsed = text
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if collapsed.count <= limit { return collapsed }
        return String(collapsed.prefix(limit)) + "…"
    }

    private func summary(for clip: Clipboard) -> String {
        switch clip.type {
        case .text: return Self.snippet(clip.text, limit: 40)
        case .image: return localization.string("图片")
        case .file: return clip.dataName ?? localization.string("文件")
        case .group: return localization.string("内容")
        }
    }

}

extension KeyboardModel.Gate {
    var diagnosticName: String {
        switch self {
        case .ok: return "ok"
        case .needsFullAccess: return "needs_full_access"
        }
    }
}

extension KeyboardModel.SyncFlash {
    var diagnosticName: String {
        switch self {
        case .success: return "success"
        case .failure: return "failure"
        }
    }
}

private extension ExtensionSyncTrigger {
    var diagnosticName: String {
        switch self {
        case .appeared: return "appeared"
        case .localClipboardChanged: return "local_clipboard_changed"
        case .manual: return "manual"
        }
    }
}

private extension ExtensionDeliveryState {
    var diagnosticName: String {
        switch self {
        case .delivered: return "delivered"
        case .partial: return "partial"
        case .offline: return "offline"
        case .pending: return "pending"
        case .failed: return "failed"
        }
    }
}

final class KeyboardDiagnostics: @unchecked Sendable {
    static let shared = KeyboardDiagnostics()

    private struct Entry: Encodable {
        let timestampMs: Int64
        let sessionID: String
        let processID: Int32
        let event: String
        let fields: [String: String]
    }

    private struct ViewState {
        var signature: String
        var lastEmission: UInt64
        var suppressed: Int
    }

    private let queue = DispatchQueue(
        label: "app.uniclipboard.keyboard.diagnostics",
        qos: .utility
    )
    private let sessionID = UUID().uuidString
    private let processID = ProcessInfo.processInfo.processIdentifier
    private let maxFileBytes = 1_048_576
    private let logURL: URL?
    private var viewStates: [String: ViewState] = [:]

    private init() {
        logURL = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: SettingsStore.appGroupID)?
            .appendingPathComponent("Library/Caches/UniClipDiagnostics", isDirectory: true)
            .appendingPathComponent("keyboard.jsonl", isDirectory: false)
        record("diagnostics.session", fields: ["phase": "started"])
    }

    func record(_ event: String, fields: [String: String] = [:]) {
        let timestampMs = Int64(Date().timeIntervalSince1970 * 1_000)
        queue.async { [self] in
            write(event: event, fields: fields, timestampMs: timestampMs)
        }
    }

    func recordView(_ name: String, signature: String) {
        let now = DispatchTime.now().uptimeNanoseconds
        let timestampMs = Int64(Date().timeIntervalSince1970 * 1_000)
        queue.async { [self] in
            var state = viewStates[name] ?? ViewState(
                signature: "",
                lastEmission: 0,
                suppressed: 0
            )
            let signatureChanged = state.signature != signature
            let elapsed = now >= state.lastEmission ? now - state.lastEmission : UInt64.max
            guard signatureChanged || elapsed >= 250_000_000 else {
                state.suppressed += 1
                viewStates[name] = state
                return
            }
            write(
                event: "view.evaluate",
                fields: [
                    "view": name,
                    "signature": signature,
                    "suppressed": String(state.suppressed),
                ],
                timestampMs: timestampMs
            )
            viewStates[name] = ViewState(
                signature: signature,
                lastEmission: now,
                suppressed: 0
            )
        }
    }

    static func elapsedMilliseconds(since start: UInt64) -> UInt64 {
        let now = DispatchTime.now().uptimeNanoseconds
        return now >= start ? (now - start) / 1_000_000 : 0
    }

    private func write(event: String, fields: [String: String], timestampMs: Int64) {
        guard let logURL else { return }
        do {
            try FileManager.default.createDirectory(
                at: logURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            var line = try JSONEncoder().encode(Entry(
                timestampMs: timestampMs,
                sessionID: sessionID,
                processID: processID,
                event: event,
                fields: fields
            ))
            line.append(0x0A)
            try trimIfNeeded(at: logURL, incomingBytes: line.count)
            if !FileManager.default.fileExists(atPath: logURL.path) {
                FileManager.default.createFile(atPath: logURL.path, contents: nil)
            }
            let handle = try FileHandle(forWritingTo: logURL)
            handle.seekToEndOfFile()
            handle.write(line)
            handle.closeFile()
        } catch {
            // Diagnostics must never affect the keyboard path they observe.
        }
    }

    private func trimIfNeeded(at url: URL, incomingBytes: Int) throws {
        let currentBytes = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size]
            as? NSNumber)?.intValue ?? 0
        guard currentBytes + incomingBytes > maxFileBytes else { return }
        let existing = try Data(contentsOf: url)
        let suffix = Data(existing.suffix(maxFileBytes / 2))
        let retained: Data
        if let newline = suffix.firstIndex(of: 0x0A) {
            let start = suffix.index(after: newline)
            retained = Data(suffix[start...])
        } else {
            retained = Data()
        }
        try retained.write(to: url, options: .atomic)
    }
}

#if DEBUG
extension KeyboardModel {
    /// Seeds a populated card row for Xcode Previews — the keyboard can only
    /// be exercised on a real device, so previews are how the layout gets
    /// eyeballed. Thumbnails resolve to the placeholder without local bytes.
    static func previewReady() -> KeyboardModel {
        let model = KeyboardModel()
        model.hasFullAccess = true
        model.gate = .ok
        model.syncFlash = .success
        model.cards = [
            Card(id: UUID(), kind: .text,
                 entry: Clipboard(type: .text, text: "明天上午 10 点开会,别忘了带上周的报表。", hasData: false, size: 18),
                 title: "明天上午 10 点开会,别忘了带上周的报表。", subtitle: nil, time: "刚刚", sizeText: "18 字"),
            Card(id: UUID(), kind: .link,
                 entry: Clipboard(type: .text, text: "https://uniclip.app/start", hasData: false, size: 25),
                 title: "https://uniclip.app/start", subtitle: "uniclip.app", time: "2 分钟前", sizeText: "25 字"),
            Card(id: UUID(), kind: .image,
                 entry: Clipboard(type: .image, text: "截屏", hasData: true, dataName: "shot.png", size: 1_240_000),
                 title: "图片", subtitle: "PNG", time: "5 分钟前", sizeText: "1.2 MB"),
            Card(id: UUID(), kind: .text,
                 entry: Clipboard(type: .text, text: "let name = \"Uni Clipboard\"", hasData: false, size: 27),
                 title: "let name = \"Uni Clipboard\"", subtitle: nil, time: "8 分钟前", sizeText: "27 字"),
        ]
        return model
    }

    static func previewEmpty() -> KeyboardModel {
        let model = KeyboardModel()
        model.hasFullAccess = true
        model.gate = .ok
        return model
    }
}
#endif
