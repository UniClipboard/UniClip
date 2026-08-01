import SwiftUI
import UIKit
import OSLog
internal import UcEngineCore

private let log = Logger(subsystem: "app.uniclipboard", category: "share")

/// The Share Extension's only screen. Loads the shared payload, lets the
/// user select recipients in the current space, sends over P2P, then dismisses.
@MainActor
struct ShareRootView: View {
    let context: ShareExtensionContext?
    let onFinish: () -> Void
    let onCancel: () -> Void

    @State private var phase: Phase = .loadingAttachment
    @State private var item: ShareItem?
    @State private var p2pRecipients: [ExtensionP2pRecipient] = []
    @State private var selectedRecipientIds = Set<String>()
    @State private var recipientLoadError: String?
    /// Mirrors the user's appearance setting from the App Group so the
    /// share sheet matches the main app instead of always rendering in
    /// whatever the system happens to be set to.
    @State private var appearance: AppearanceMode = .system
    @State private var localization = ExtensionLocalization()
    @State private var shareStage: ShareUploadStage = .connecting
    @State private var transferProgress: ExtensionTransferProgress?

    enum Phase: Equatable {
        case loadingAttachment
        case ready
        case uploading
        case succeeded
        case handedOff
        case failed(String)
    }

    var body: some View {
        NavigationStack {
            Group {
                switch phase {
                case .loadingAttachment:
                    centered { ProgressView(localization.string("正在读取分享内容…")) }
                case .ready:
                    readyForm
                case .uploading:
                    shareProgressView
                case .succeeded:
                    shareProgressView
                case .handedOff:
                    centered {
                        VStack(spacing: 12) {
                            Image(systemName: "arrow.down.doc.fill")
                                .font(.largeTitle)
                                .foregroundStyle(.blue)
                            Text(localization.string("文件已保存，请打开 UniClip 继续发送"))
                                .font(.headline)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, 24)
                        }
                    }
                case .failed(let msg):
                    centered {
                        VStack(spacing: 12) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .font(.largeTitle)
                                .foregroundStyle(.orange)
                            Text(localization.string("发送失败"))
                                .font(.headline)
                            Text(msg)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, 24)
                        }
                    }
                }
            }
            .navigationTitle(localization.string("分享到 UniClipboard"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(localization.string("取消")) { cancelAndCleanup() }
                        .disabled(phase == .uploading)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    trailingButton
                }
            }
        }
        .task { await loadEverything() }
        .environment(\.locale, localization.locale)
        .preferredColorScheme(appearance.colorScheme)
    }

}

private extension ShareRootView {
    // MARK: - Subviews

    @ViewBuilder
    private var readyForm: some View {
        Form {
            Section(localization.string("内容")) {
                if let item {
                    contentRow(for: item)
                }
            }

            Section(
                header: Text(localization.string("接收设备")),
                footer: Text(localization.string("选择设备后才会连接和发送"))
            ) {
                if let recipientLoadError {
                    Text(recipientLoadError)
                        .foregroundStyle(.secondary)
                } else if p2pRecipients.isEmpty {
                    Text(localization.string("没有已配对的接收设备"))
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(p2pRecipients, id: \.deviceId) { recipient in
                        Button {
                            toggleRecipient(recipient.deviceId)
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "desktopcomputer")
                                    .foregroundStyle(.tint)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(recipient.displayName)
                                        .foregroundStyle(.primary)
                                    Text(localization.string(
                                        recipient.wasLastKnownOnline
                                            ? "上次状态：在线"
                                            : "上次状态：离线"
                                    ))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if selectedRecipientIds.contains(recipient.deviceId) {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(.tint)
                                } else {
                                    Image(systemName: "circle")
                                        .foregroundStyle(.tertiary)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(
                            selectedRecipientIds.contains(recipient.deviceId) ? .isSelected : []
                        )
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func contentRow(for item: ShareItem) -> some View {
        HStack(alignment: .top, spacing: 12) {
            iconView(for: item)
                .frame(width: 44, height: 44)
            VStack(alignment: .leading, spacing: 4) {
                Text(item.displayName)
                    .font(.callout)
                    .lineLimit(3)
                Text(sizeLabel(for: item))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func iconView(for item: ShareItem) -> some View {
        switch item {
        case .text:
            iconBadge(systemName: "doc.text", tint: .blue)
        case .image(let bytes, _):
            if let uiImage = UIImage(data: bytes) {
                Image(uiImage: uiImage)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(width: 44, height: 44)
                    .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            } else {
                iconBadge(systemName: "photo", tint: .pink)
            }
        case .file:
            iconBadge(systemName: "doc", tint: .orange)
        }
    }

    private func iconBadge(systemName: String, tint: Color) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(tint.opacity(0.15))
            Image(systemName: systemName)
                .foregroundStyle(tint)
        }
    }

    private var shareProgressView: some View {
        Form {
            Section {
                progressHero
            }

            if let item {
                Section(localization.string("内容")) {
                    contentRow(for: item)
                }
            }

            Section(localization.string("发送状态")) {
                ForEach(ShareUploadStage.allCases, id: \.self) { stage in
                    stageRow(for: stage)
                }
            }

            if shareStage == .sending {
                Section(localization.string("传输进度")) {
                    transferProgressView
                }
            }
        }
    }

    private var progressHero: some View {
        VStack(spacing: 8) {
            if shareStage == .sent {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 52, weight: .semibold))
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(.green)
            } else {
                Image(systemName: "paperplane.circle.fill")
                    .font(.system(size: 52, weight: .semibold))
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(.tint)
            }
            Text(label(for: shareStage))
                .font(.title3.weight(.semibold))
            Text(localization.string("发送到 %@", selectedDestinationName))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
    }

    @ViewBuilder
    private func stageRow(for stage: ShareUploadStage) -> some View {
        HStack(spacing: 12) {
            shareStageIcon(for: stage)
                .frame(width: 22, height: 22)
            Text(label(for: stage))
                .foregroundStyle(stage.rawValue <= shareStage.rawValue ? .primary : .secondary)
            Spacer()
            if stage.rawValue < shareStage.rawValue || shareStage == .sent {
                Image(systemName: "checkmark")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.green)
            }
        }
    }

    @ViewBuilder
    private var transferProgressView: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let transferProgress, let totalBytes = transferProgress.totalBytes, totalBytes > 0 {
                ProgressView(
                    value: Double(transferProgress.completedBytes),
                    total: Double(totalBytes)
                )
                Text(localization.string(
                    "已发送 %@ / %@",
                    localization.byteCount(Int(clamping: transferProgress.completedBytes)),
                    localization.byteCount(Int(clamping: totalBytes))
                ))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                HStack(spacing: 10) {
                    ProgressView()
                    Text(localization.string("正在等待传输进度"))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func shareStageIcon(for stage: ShareUploadStage) -> some View {
        if shareStage == .sent || stage.rawValue < shareStage.rawValue {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
        } else if stage == shareStage {
            ProgressView()
                .controlSize(.small)
        } else {
            Image(systemName: "circle")
                .foregroundStyle(.tertiary)
        }
    }

    private func label(for stage: ShareUploadStage) -> String {
        switch stage {
        case .connecting: return localization.string("正在连接")
        case .connected: return localization.string("已连接")
        case .sending: return localization.string("正在发送")
        case .sent: return localization.string("发送完成")
        }
    }

    private func sizeLabel(for item: ShareItem) -> String {
        switch item {
        case .text(let text):
            return localization.string("文本 · %lld 字", Int64(text.count))
        case .image(let bytes, let ext):
            return localization.string(
                "图片 · %@ · %@",
                ext.uppercased(),
                localization.byteCount(bytes.count)
            )
        case .file(let staged):
            return localization.string("文件 · %@", localization.byteCount(Int(staged.byteCount)))
        }
    }

    @ViewBuilder
    private var trailingButton: some View {
        switch phase {
        case .succeeded, .handedOff, .failed:
            Button(localization.string("完成")) { finishAndCleanup() }
                .bold()
        case .ready:
            Button(localization.string("发送")) { Task { await send() } }
                .bold()
                .disabled(!canSend)
        default:
            EmptyView()
        }
    }

    // MARK: - Helpers

    private var canSend: Bool {
        item != nil && !selectedRecipientIds.isEmpty
    }

    private var selectedDestinationName: String {
        let names = p2pRecipients
            .filter { selectedRecipientIds.contains($0.deviceId) }
            .map(\.displayName)
        if names.count == 1, let name = names.first { return name }
        if !names.isEmpty {
            return localization.string("已选择 %lld 台设备", Int64(names.count))
        }
        return localization.string("未选择接收设备")
    }

    private func toggleRecipient(_ id: String) {
        if selectedRecipientIds.contains(id) {
            selectedRecipientIds.remove(id)
        } else {
            selectedRecipientIds.insert(id)
        }
    }

    private func centered<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack {
            Spacer()
            content()
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Actions

    private func loadEverything() async {
        let store = SettingsStore()
        let loadedSettings = store.loadAppSettings()
        appearance = loadedSettings.appearance
        localization = ExtensionLocalization(preference: loadedSettings.language)
        await loadP2pRecipients()

        guard let ctx = context else {
            log.error("loadEverything: no extension context")
            phase = .failed(localization.string("没有可分享的内容"))
            return
        }
        do {
            let extracted = try await ShareItemExtractor.extract(from: ctx)
            log.info("loadEverything: extracted \(extracted.kindLabel, privacy: .public) bytes=\(extracted.byteCount, privacy: .public)")
            item = extracted
            phase = .ready
        } catch {
            // The activation rule matched but extraction failed — the
            // source app advertised a UTI it couldn't fulfill, or our
            // extractor has a gap. Bug-grade either way.
            log.error("loadEverything: extraction failed: \(String(describing: error), privacy: .public)")
            let message = (error as? ShareItemError)?.message(using: localization)
                ?? (error as? LocalizedError)?.errorDescription
                ?? localization.string("读取分享内容失败: %@", String(describing: error))
            phase = .failed(message)
        }
    }

    private func loadP2pRecipients() async {
        do {
            let recipients = try await ExtensionSyncExecutor.run {
                let client = try ExtensionP2pClient()
                defer { client.shutdown() }
                return try client.recipients()
            }
            p2pRecipients = recipients
            if recipients.count == 1, let recipient = recipients.first {
                selectedRecipientIds = [recipient.deviceId]
            }
        } catch {
            recipientLoadError = localization.string("无法读取接收设备")
        }
    }

    private func send() async {
        guard let item else { return }
        let targetDevices = selectedRecipientIds.sorted()
        if targetDevices.isEmpty { return }
        let diagnostics = makeShareDiagnostics(for: item)
        diagnostics?.record(stage: .attemptStarted)
        if case .file(let staged) = item,
           !OutboundShareStore.shouldSendDirectly(byteCount: staged.byteCount) {
            handoffFileToApp(staged, targetDeviceIds: targetDevices, diagnostics: diagnostics)
            return
        }
        phase = .uploading
        shareStage = .connecting
        transferProgress = nil
        do {
            try await ShareUploader().uploadP2p(
                item,
                targetDevices: targetDevices,
                diagnostics: diagnostics,
                onStage: { stage in
                    updateShareStage(stage)
                },
                onTransferProgress: { progress in
                    updateTransferProgress(progress)
                }
            )
            discardStagedFileIfNeeded()
            phase = .succeeded
        } catch {
            let connectionTimedOut =
                (error as? ExtensionPeerConnectionError)
                == ExtensionPeerConnectionError.connectionTimedOut
            let itemIsFile: Bool
            if case .file = item { itemIsFile = true } else { itemIsFile = false }
            if OutboundShareFallbackPolicy.shouldHandoff(
                itemIsFile: itemIsFile,
                connectionTimedOut: connectionTimedOut
            ), case .file(let staged) = item {
                handoffFileToApp(staged, targetDeviceIds: targetDevices, diagnostics: diagnostics)
                return
            }
            phase = .failed(message(for: error))
        }
    }

    private func makeShareDiagnostics(for item: ShareItem) -> ShareDiagnosticRecorder? {
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: SettingsStore.appGroupID
        ), let store = try? ShareDiagnosticsStore(containerURL: containerURL)
        else { return nil }
        return try? store.startAttempt(
            itemKind: item.diagnosticKind,
            byteCount: Int(clamping: item.byteCount)
        )
    }

    private func handoffFileToApp(
        _ staged: StagedShareFile,
        targetDeviceIds: [String],
        diagnostics: ShareDiagnosticRecorder?
    ) {
        diagnostics?.record(stage: .handoffStarted)
        do {
            try OutboundShareStore().enqueue(
                staged,
                targetDeviceIds: targetDeviceIds
            )
            diagnostics?.record(stage: .handoffQueued)
            phase = .handedOff
        } catch {
            diagnostics?.record(
                stage: .failed,
                error: ShareDiagnosticError(code: .handoffFailed)
            )
            phase = .failed(localization.string("保存待发送文件失败"))
        }
    }

    private func discardStagedFileIfNeeded() {
        guard case .file(let staged) = item else { return }
        try? OutboundShareStore().discardStagedFile(staged)
    }

    private func updateShareStage(_ stage: ShareUploadStage) {
        shareStage = stage
    }

    private func updateTransferProgress(_ progress: ExtensionTransferProgress) {
        transferProgress = progress
    }

    private func cancelAndCleanup() {
        if phase != .handedOff { discardStagedFileIfNeeded() }
        onCancel()
    }

    private func finishAndCleanup() {
        if phase != .handedOff { discardStagedFileIfNeeded() }
        onFinish()
    }

    private func message(for error: Error) -> String {
        if let connectionError = error as? ExtensionPeerConnectionError {
            switch connectionError {
            case .noOnlinePeer:
                return localization.string("没有可用的接收设备")
            case .connectionTimedOut:
                return localization.string("连接恢复超时，请稍后重试")
            }
        }
        return (error as? LocalizedError)?.errorDescription
            ?? localization.string("同步失败")
    }
}
