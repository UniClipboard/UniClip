import Foundation

/// User-selectable UI appearance. `system` defers to iOS; `light`/`dark`
/// force a specific scheme regardless of system setting. Raw String so the
/// persisted JSON stays human-readable and forward-compatible — unknown
/// values fall back to `.system` on decode.
public enum AppearanceMode: String, Codable, CaseIterable, Sendable {
    case system
    case light
    case dark
}

/// User-tunable application settings persisted under the `app_settings` key.
/// Spec: docs/SYNC_PROTOCOL.md §5.4. All keys are forward-compatible:
/// missing keys are filled with defaults; unknown keys are tolerated.
public struct AppSettings: Codable, Equatable, Hashable, Sendable {
    public var trustInsecureCert: Bool
    public var autoCheckUpdate: Bool
    public var manualUploadDialogShown: Bool
    public var downloadRelativePath: String
    public var logViewLevelFilter: String
    public var ignoredVersion: String?
    /// When true, the sync engine writes new server-side content directly
    /// to `UIPasteboard.general`. When false, new server content is staged
    /// in the UI (highlighted card, expanded preview) but not written.
    /// Default true: tracks the "auto sync" semantics introduced in
    /// cycle 9 — users shouldn't have to think about upload/download.
    public var autoApplyServerChanges: Bool
    /// When true, the sync engine actively READS `UIPasteboard.general`
    /// every tick and auto-pushes new local content to the server. iOS 16+
    /// shows an "Allow Paste" prompt each time it reads content copied from
    /// another app. This is on by default so push and pull both follow the
    /// app's automatic-sync behavior; users can turn it off in Settings.
    ///
    /// When false, the engine never reads pasteboard content on its own —
    /// it only polls the free `changeCount` / `hasStrings` signals to
    /// surface a "本机有新内容可推送" hint on Home (`DevicePasteboardObserver.detection`).
    public var autoPushDeviceChanges: Bool
    /// When true, the sync engine fires a fire-and-forget cache prefetch
    /// for incoming entries with `hasData == true`, so that tapping a row
    /// later opens the preview without a network round-trip.
    public var prefetchAttachments: Bool
    /// Gates `prefetchAttachments` against the current network class.
    /// Default false — cellular bytes are precious; opt-in only.
    public var prefetchOnCellular: Bool
    /// Disk cap for the on-device payload cache, in bytes. Shrinking this
    /// at runtime evicts immediately via `PayloadCache.setMaxBytes(_:)`.
    public var payloadCacheMaxBytes: Int
    /// UI appearance preference. Default `.system` so existing installs
    /// keep their current behavior (follow iOS appearance).
    public var appearance: AppearanceMode
    /// UI language preference mirrored from the React Native app. `system`
    /// follows the extension host locale; explicit values keep extensions in
    /// sync with the language selected inside UniClip.
    public var language: String
    /// When true, key taps in the UniClip keyboard extension play the
    /// system key-click sound via `UIDevice.playInputClick()` — which iOS
    /// further gates on the global 键盘点击音 switch. Default true to match
    /// a stock keyboard. Lives in `app_settings` so the App Group-shared
    /// keyboard reads it without a dedicated key.
    public var keyboardSoundFeedback: Bool
    /// When true, key taps in the UniClip keyboard extension fire a light
    /// haptic. iOS blocks haptics for keyboards without Full Access, which
    /// the keyboard already requires for its core sync, so this is free to
    /// honor. Default true.
    public var keyboardHapticFeedback: Bool
    /// Whether the first-run onboarding (feature walkthrough) has been shown.
    /// False on a fresh install → `ContentView` routes into `OnboardingView`
    /// before `SetupFlowView`. Set true when the user finishes/skips
    /// onboarding; `AppViewModel.init` also force-sets it for upgraded
    /// installs that already have servers, so they never see onboarding.
    public var onboardingShown: Bool
    /// Whether the Home paste-permission hint banner has been dismissed. The
    /// banner only shows while `autoPushDeviceChanges` is on (the engine then
    /// reads the pasteboard each tick, which iOS gates behind「允许粘贴」); once
    /// the user dismisses it we don't nag again.
    public var pastePermissionHintDismissed: Bool
    /// Whether the post-pairing "解锁更多" enhancements carousel (keyboard /
    /// share / paste tutorials) has been shown. False on a fresh install →
    /// `ContentView` auto-presents the carousel once, right after the first-run
    /// pairing completes. Set true the moment it's presented so it never pops
    /// again; `AppViewModel.init` also force-sets it for upgraded installs that
    /// already have servers, so they skip the prompt entirely. The same three
    /// tutorials stay re-viewable from Settings →「功能引导」regardless.
    public var enhancementsPromptShown: Bool

    public static let defaults = AppSettings(
        trustInsecureCert: false,
        autoCheckUpdate: true,
        manualUploadDialogShown: false,
        downloadRelativePath: "",
        logViewLevelFilter: "info",
        ignoredVersion: nil,
        autoApplyServerChanges: true,
        autoPushDeviceChanges: true,
        prefetchAttachments: true,
        prefetchOnCellular: false,
        payloadCacheMaxBytes: 200 * 1024 * 1024,
        appearance: .system,
        language: "system",
        keyboardSoundFeedback: true,
        keyboardHapticFeedback: true,
        onboardingShown: false,
        pastePermissionHintDismissed: false,
        enhancementsPromptShown: false
    )

    public init(
        trustInsecureCert: Bool = false,
        autoCheckUpdate: Bool = true,
        manualUploadDialogShown: Bool = false,
        downloadRelativePath: String = "",
        logViewLevelFilter: String = "info",
        ignoredVersion: String? = nil,
        autoApplyServerChanges: Bool = true,
        autoPushDeviceChanges: Bool = true,
        prefetchAttachments: Bool = true,
        prefetchOnCellular: Bool = false,
        payloadCacheMaxBytes: Int = 200 * 1024 * 1024,
        appearance: AppearanceMode = .system,
        language: String = "system",
        keyboardSoundFeedback: Bool = true,
        keyboardHapticFeedback: Bool = true,
        onboardingShown: Bool = false,
        pastePermissionHintDismissed: Bool = false,
        enhancementsPromptShown: Bool = false
    ) {
        self.trustInsecureCert = trustInsecureCert
        self.autoCheckUpdate = autoCheckUpdate
        self.manualUploadDialogShown = manualUploadDialogShown
        self.downloadRelativePath = downloadRelativePath
        self.logViewLevelFilter = logViewLevelFilter
        self.ignoredVersion = ignoredVersion
        self.autoApplyServerChanges = autoApplyServerChanges
        self.autoPushDeviceChanges = autoPushDeviceChanges
        self.prefetchAttachments = prefetchAttachments
        self.prefetchOnCellular = prefetchOnCellular
        self.payloadCacheMaxBytes = payloadCacheMaxBytes
        self.appearance = appearance
        self.language = language
        self.keyboardSoundFeedback = keyboardSoundFeedback
        self.keyboardHapticFeedback = keyboardHapticFeedback
        self.onboardingShown = onboardingShown
        self.pastePermissionHintDismissed = pastePermissionHintDismissed
        self.enhancementsPromptShown = enhancementsPromptShown
    }

    private enum CodingKeys: String, CodingKey {
        case trustInsecureCert, autoCheckUpdate, manualUploadDialogShown
        case downloadRelativePath, logViewLevelFilter, ignoredVersion
        case autoApplyServerChanges
        case autoPushDeviceChanges
        case prefetchAttachments, prefetchOnCellular, payloadCacheMaxBytes
        case appearance, language
        case keyboardSoundFeedback, keyboardHapticFeedback
        case onboardingShown
        case pastePermissionHintDismissed
        case enhancementsPromptShown
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let defaults = AppSettings.defaults
        trustInsecureCert       = try container.decodeIfPresent(Bool.self,   forKey: .trustInsecureCert)       ?? defaults.trustInsecureCert
        autoCheckUpdate         = try container.decodeIfPresent(Bool.self,   forKey: .autoCheckUpdate)         ?? defaults.autoCheckUpdate
        manualUploadDialogShown = try container.decodeIfPresent(Bool.self,   forKey: .manualUploadDialogShown) ?? defaults.manualUploadDialogShown
        downloadRelativePath    = try container.decodeIfPresent(String.self, forKey: .downloadRelativePath)    ?? defaults.downloadRelativePath
        logViewLevelFilter      = try container.decodeIfPresent(String.self, forKey: .logViewLevelFilter)      ?? defaults.logViewLevelFilter
        ignoredVersion          = try container.decodeIfPresent(String.self, forKey: .ignoredVersion)
        autoApplyServerChanges  = try container.decodeIfPresent(Bool.self,   forKey: .autoApplyServerChanges)  ?? defaults.autoApplyServerChanges
        autoPushDeviceChanges   = try container.decodeIfPresent(Bool.self,   forKey: .autoPushDeviceChanges)   ?? defaults.autoPushDeviceChanges
        prefetchAttachments     = try container.decodeIfPresent(Bool.self,   forKey: .prefetchAttachments)     ?? defaults.prefetchAttachments
        prefetchOnCellular      = try container.decodeIfPresent(Bool.self,   forKey: .prefetchOnCellular)      ?? defaults.prefetchOnCellular
        payloadCacheMaxBytes    = try container.decodeIfPresent(Int.self,    forKey: .payloadCacheMaxBytes)    ?? defaults.payloadCacheMaxBytes
        // Unknown raw value (e.g. an older client wrote something we don't
        // recognize, or the key was hand-edited) falls back to system —
        // safer than throwing and losing every other setting in the blob.
        if let raw = try container.decodeIfPresent(String.self, forKey: .appearance) {
            appearance = AppearanceMode(rawValue: raw) ?? defaults.appearance
        } else {
            appearance = defaults.appearance
        }
        if let languagePreference = try container.decodeIfPresent(String.self, forKey: .language),
           ["system", "zh-CN", "en", "ru", "pt-BR"].contains(languagePreference) {
            language = languagePreference
        } else {
            language = defaults.language
        }
        keyboardSoundFeedback   = try container.decodeIfPresent(Bool.self,   forKey: .keyboardSoundFeedback)   ?? defaults.keyboardSoundFeedback
        keyboardHapticFeedback  = try container.decodeIfPresent(Bool.self,   forKey: .keyboardHapticFeedback)  ?? defaults.keyboardHapticFeedback
        onboardingShown         = try container.decodeIfPresent(Bool.self,   forKey: .onboardingShown)         ?? defaults.onboardingShown
        pastePermissionHintDismissed = try container.decodeIfPresent(Bool.self, forKey: .pastePermissionHintDismissed) ?? defaults.pastePermissionHintDismissed
        enhancementsPromptShown = try container.decodeIfPresent(Bool.self, forKey: .enhancementsPromptShown) ?? defaults.enhancementsPromptShown
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(trustInsecureCert,       forKey: .trustInsecureCert)
        try container.encode(autoCheckUpdate,         forKey: .autoCheckUpdate)
        try container.encode(manualUploadDialogShown, forKey: .manualUploadDialogShown)
        try container.encode(downloadRelativePath,    forKey: .downloadRelativePath)
        try container.encode(logViewLevelFilter,      forKey: .logViewLevelFilter)
        try container.encodeIfPresent(ignoredVersion, forKey: .ignoredVersion)
        try container.encode(autoApplyServerChanges,  forKey: .autoApplyServerChanges)
        try container.encode(autoPushDeviceChanges,   forKey: .autoPushDeviceChanges)
        try container.encode(prefetchAttachments,     forKey: .prefetchAttachments)
        try container.encode(prefetchOnCellular,      forKey: .prefetchOnCellular)
        try container.encode(payloadCacheMaxBytes,    forKey: .payloadCacheMaxBytes)
        try container.encode(appearance.rawValue,     forKey: .appearance)
        try container.encode(language,                forKey: .language)
        try container.encode(keyboardSoundFeedback,   forKey: .keyboardSoundFeedback)
        try container.encode(keyboardHapticFeedback,  forKey: .keyboardHapticFeedback)
        try container.encode(onboardingShown,         forKey: .onboardingShown)
        try container.encode(pastePermissionHintDismissed, forKey: .pastePermissionHintDismissed)
        try container.encode(enhancementsPromptShown, forKey: .enhancementsPromptShown)
    }
}

public extension AppSettings {
    /// §5.5 — `UserDefaults` keys (also reused inside an App Group when sharing with extensions).
    enum PersistenceKey {
        public static let serverConfigList = "server_config_list"
        public static let appSettings      = "app_settings"
        public static let legacyServerConfig = "server_config"
        /// Cycle 9 — runtime sync state. The most recent content hash that
        /// the engine confirmed both sides shared. NOT a user setting; lives
        /// outside `app_settings` so it can be cleared without touching prefs.
        public static let lastSyncedContentHash = "last_synced_content_hash"
        /// Cycle 11 — local observation log: every Clipboard the engine
        /// pulled or pushed, newest-first, capped client-side. Not part of
        /// the wire protocol; the server only keeps one record (§2.1).
        public static let clipboardHistory = "clipboard_history"
        /// Cycle 11 — incremental-sync watermark for §2.7
        /// (`POST /api/history/query`). The highest `lastModified` seen
        /// in any prior page; passed back as `modifiedAfter` so the
        /// server only returns strictly-newer records. Stored as an
        /// ISO-8601 string so the wire format and the persisted form
        /// match (debugging via `defaults read` is then trivial).
        public static let historyModifiedAfter = "history_modified_after"
        /// When the engine last finished a §2.7 history pull (success
        /// OR failure — `runHistorySyncIfDue` writes through `defer` so
        /// a 500-ing server doesn't get hammered). Persisting it stops
        /// the in-memory throttle from being bypassed every cold launch,
        /// which otherwise triggered a full pagination on every app
        /// open. ISO-8601 string for `defaults read` debuggability,
        /// matching `historyModifiedAfter`.
        public static let lastHistorySyncAt = "last_history_sync_at"
        /// Written by the keyboard extension on each `viewDidAppear` so
        /// the main app can detect whether the extension is installed.
        public static let keyboardExtensionEnabled = "keyboard_extension_enabled"
        /// Written alongside `keyboardExtensionEnabled`; reflects the
        /// `hasFullAccess` state at the time the keyboard last appeared.
        public static let keyboardExtensionFullAccess = "keyboard_extension_full_access"
        /// The `UIPasteboard.changeCount` the keyboard extension last synced.
        /// Lets the keyboard's uplink skip the prompting content read when
        /// nothing new has been copied since. Not a user setting.
        public static let lastSyncedChangeCount = "last_synced_change_count"
    }
}
