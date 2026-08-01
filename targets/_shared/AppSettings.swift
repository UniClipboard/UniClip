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
/// All keys are forward-compatible:
/// missing keys are filled with defaults; unknown keys are tolerated.
public struct AppSettings: Codable, Equatable, Hashable, Sendable {
    public var autoCheckUpdate: Bool
    public var manualUploadDialogShown: Bool
    public var downloadRelativePath: String
    public var logViewLevelFilter: String
    public var ignoredVersion: String?
    /// Whether received P2P content may be applied automatically.
    public var autoApplyRemoteChanges: Bool
    /// When true, the sync engine actively READS `UIPasteboard.general`
    /// every tick and sends new local content over P2P. iOS 16+
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
    /// installs that already completed setup, so they never see onboarding.
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
    /// already completed setup, so they skip the prompt entirely. The same three
    /// tutorials stay re-viewable from Settings →「功能引导」regardless.
    public var enhancementsPromptShown: Bool

    public static let defaults = AppSettings(
        autoCheckUpdate: true,
        manualUploadDialogShown: false,
        downloadRelativePath: "",
        logViewLevelFilter: "info",
        ignoredVersion: nil,
        autoApplyRemoteChanges: true,
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
        autoCheckUpdate: Bool = true,
        manualUploadDialogShown: Bool = false,
        downloadRelativePath: String = "",
        logViewLevelFilter: String = "info",
        ignoredVersion: String? = nil,
        autoApplyRemoteChanges: Bool = true,
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
        self.autoCheckUpdate = autoCheckUpdate
        self.manualUploadDialogShown = manualUploadDialogShown
        self.downloadRelativePath = downloadRelativePath
        self.logViewLevelFilter = logViewLevelFilter
        self.ignoredVersion = ignoredVersion
        self.autoApplyRemoteChanges = autoApplyRemoteChanges
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
        case autoCheckUpdate, manualUploadDialogShown
        case downloadRelativePath, logViewLevelFilter, ignoredVersion
        case autoApplyRemoteChanges
        case legacyAutoApplyServerChanges = "autoApplyServerChanges"
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
        autoCheckUpdate         = try container.decodeIfPresent(Bool.self,   forKey: .autoCheckUpdate)         ?? defaults.autoCheckUpdate
        manualUploadDialogShown = try container.decodeIfPresent(Bool.self,   forKey: .manualUploadDialogShown) ?? defaults.manualUploadDialogShown
        downloadRelativePath    = try container.decodeIfPresent(String.self, forKey: .downloadRelativePath)    ?? defaults.downloadRelativePath
        logViewLevelFilter      = try container.decodeIfPresent(String.self, forKey: .logViewLevelFilter)      ?? defaults.logViewLevelFilter
        ignoredVersion          = try container.decodeIfPresent(String.self, forKey: .ignoredVersion)
        autoApplyRemoteChanges  = try container.decodeIfPresent(Bool.self, forKey: .autoApplyRemoteChanges)
            ?? container.decodeIfPresent(Bool.self, forKey: .legacyAutoApplyServerChanges)
            ?? defaults.autoApplyRemoteChanges
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
        try container.encode(autoCheckUpdate,         forKey: .autoCheckUpdate)
        try container.encode(manualUploadDialogShown, forKey: .manualUploadDialogShown)
        try container.encode(downloadRelativePath,    forKey: .downloadRelativePath)
        try container.encode(logViewLevelFilter,      forKey: .logViewLevelFilter)
        try container.encodeIfPresent(ignoredVersion, forKey: .ignoredVersion)
        try container.encode(autoApplyRemoteChanges,  forKey: .autoApplyRemoteChanges)
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
    /// `UserDefaults` keys shared with app extensions.
    enum PersistenceKey {
        public static let appSettings      = "app_settings"
        /// Local observation log, newest-first and capped client-side.
        public static let clipboardHistory = "clipboard_history"
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
