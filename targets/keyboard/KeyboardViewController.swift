import UIKit

/// Principal class for the UniClip custom keyboard. iOS instantiates this
/// (`NSExtensionPrincipalClass = $(PRODUCT_MODULE_NAME).KeyboardViewController`)
/// when the user switches to the UniClip keyboard. It subclasses
/// `UIInputViewController` and owns a fixed-height UIKit surface so a newly
/// created extension never has to bootstrap a second rendering runtime.
///
/// The keyboard's job is clipboard *sync*, not text entry. On appear it:
///   1. reads the device pasteboard and pushes anything new to the active
///      server (**uplink** — "open keyboard = auto-sync"); and
///   2. pulls the server's latest clipboard and offers it as a one-tap
///      insert candidate (**downlink** — `insertText`, no pasteboard hop).
///
/// Both halves need **Full Access** (`RequestsOpenAccess=YES` + the user's
/// "允许完全访问" toggle): without it, `UIPasteboard` and `URLSession` are
/// both unavailable to a keyboard, so we render a "needs Full Access" hint
/// instead. The first content read after Full Access is granted fires iOS's
/// per-app "允许粘贴" prompt once; after the user allows, reads are silent —
/// which is exactly what makes the auto-sync feel automatic.
final class KeyboardViewController: UIInputViewController {
    private let model = KeyboardModel()
    private var keyboardView: KeyboardRootView?
    private var keyboardSurfaceHeightConstraint: NSLayoutConstraint?
    private let controllerID = UUID().uuidString
    private var lastLoggedLayoutSize = CGSize.zero

    /// Custom keyboard height, sized to *hug* its content so the card row sits
    /// snug between the top bar and the key row instead of floating in a tall
    /// frame. The Paste-style layout stacks a branded/search top bar, a row of
    /// clipboard cards, and the space/⌫/return key row — that's
    /// `KeyboardLayoutMetrics.contentHeight`, **computed from the same constants the
    /// UIKit layout consumes** (a hand-summed constant here once lagged a
    /// 2pt top-bar change and clipped the card row into looking like it had
    /// divider lines). The globe strip is added only when iOS needs an
    /// input-mode switch key (see `viewDidAppear`); without it the strip
    /// collapses and the keyboard shrinks by the same band, rather than letting
    /// the freed space float the cards up off the keys. Priority 999 (not
    /// required) so it can never conflict with the system-imposed constraints
    /// on the input view.
    private lazy var heightConstraint: NSLayoutConstraint = {
        let constraint = view.heightAnchor.constraint(
            equalToConstant: KeyboardLayoutMetrics.contentHeight
        )
        constraint.priority = UILayoutPriority(999)
        return constraint
    }()

    override func loadView() {
        let targetHeight = initialTargetHeight
        let inputView = UIInputView(
            frame: CGRect(x: 0, y: 0, width: 0, height: targetHeight),
            inputViewStyle: .default
        )
        inputView.allowsSelfSizing = true
        inputView.backgroundColor = .clear
        inputView.isOpaque = false
        view = inputView
        preferredContentSize.height = targetHeight
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        KeyboardDiagnostics.shared.record("controller.load", fields: [
            "controllerID": controllerID,
        ])

        // Wire the model's UI callbacks to the input controller. `unowned`
        // is safe: the model is owned by (and outlived by) this controller.
        model.insertText = { [unowned self] text in
            self.textDocumentProxy.insertText(text)
        }
        model.deleteBackward = { [unowned self] in
            self.textDocumentProxy.deleteBackward()
        }
        model.advanceInputMode = { [unowned self] in
            self.advanceToNextInputMode()
        }
        model.dismiss = { [unowned self] in
            self.dismissKeyboard()
        }
        model.openSettings = { [unowned self] in
            guard let url = KeyboardSettingsURL.destination else { return }
            self.extensionContext?.open(url, completionHandler: nil)
        }
        // The click only sounds when our input view adopts
        // `UIInputViewAudioFeedback` (below) and the user has 键盘点击音 on —
        // so the model can call this unconditionally and let iOS decide.
        model.playInputClick = {
            UIDevice.current.playInputClick()
        }
        model.prepareForFirstPresentation(
            fullAccess: hasFullAccess,
            needsInputModeSwitchKey: needsInputModeSwitchKey,
            returnKeyType: textDocumentProxy.returnKeyType
        )
        updateHeightConstraint()
        heightConstraint.isActive = true

        let keyboardView = KeyboardRootView(viewStore: model)
        keyboardView.onPreferredHeightChange = { [weak self] targetHeight in
            self?.applyTargetHeight(targetHeight)
        }
        self.keyboardView = keyboardView
        view.addSubview(keyboardView)
        let keyboardSurfaceHeightConstraint = keyboardView.heightAnchor.constraint(
            equalToConstant: keyboardView.preferredHeight
        )
        self.keyboardSurfaceHeightConstraint = keyboardSurfaceHeightConstraint
        NSLayoutConstraint.activate([
            keyboardView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            keyboardView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            keyboardView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            keyboardSurfaceHeightConstraint,
        ])
        applyTargetHeight(keyboardView.preferredHeight)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        KeyboardDiagnostics.shared.record("controller.appear", fields: [
            "controllerID": controllerID,
            "animated": String(animated),
            "fullAccess": String(hasFullAccess),
            "needsInputModeSwitchKey": String(needsInputModeSwitchKey),
        ])
        // `hasFullAccess` / `needsInputModeSwitchKey` are only reliable once
        // the input view is on screen — read them here, then drive the sync.
        model.needsInputModeSwitchKey = needsInputModeSwitchKey
        model.hasFullAccess = hasFullAccess
        updateHeightConstraint()
        model.setReturnKeyType(textDocumentProxy.returnKeyType)
        model.onAppear()
        if let group = UserDefaults(suiteName: SettingsStore.appGroupID) {
            group.set(true, forKey: AppSettings.PersistenceKey.keyboardExtensionEnabled)
            group.set(hasFullAccess, forKey: AppSettings.PersistenceKey.keyboardExtensionFullAccess)
        }
    }

    /// The host field can change (e.g. tapping from a search box to a body
    /// field) while our keyboard stays up. Re-read the Return-key intent so
    /// the key relabels itself (发送 / 搜索 / …) to match.
    override func textDidChange(_ textInput: (any UITextInput)?) {
        super.textDidChange(textInput)
        model.setReturnKeyType(textDocumentProxy.returnKeyType)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let size = view.bounds.size
        guard abs(size.width - lastLoggedLayoutSize.width) >= 0.5
                || abs(size.height - lastLoggedLayoutSize.height) >= 0.5 else { return }
        lastLoggedLayoutSize = size
        let keyboardSurfaceHeight = keyboardView?.bounds.height
            ?? keyboardSurfaceHeightConstraint?.constant
            ?? 0
        KeyboardDiagnostics.shared.record("controller.layout", fields: [
            "controllerID": controllerID,
            "width": String(format: "%.1f", size.width),
            "height": String(format: "%.1f", size.height),
            "surfaceHeight": String(format: "%.1f", keyboardSurfaceHeight),
        ])
    }

    private func updateHeightConstraint() {
        heightConstraint.constant = KeyboardLayoutMetrics.targetHeight(
            hasFullAccess: hasFullAccess,
            needsInputModeSwitchKey: needsInputModeSwitchKey
        )
        preferredContentSize.height = heightConstraint.constant
    }

    private var initialTargetHeight: CGFloat {
        KeyboardLayoutMetrics.targetHeight(
            hasFullAccess: hasFullAccess,
            needsInputModeSwitchKey: needsInputModeSwitchKey
        )
    }

    private func applyTargetHeight(_ targetHeight: CGFloat) {
        heightConstraint.constant = targetHeight
        keyboardSurfaceHeightConstraint?.constant = targetHeight
        preferredContentSize.height = targetHeight
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        KeyboardDiagnostics.shared.record("controller.disappear", fields: [
            "controllerID": controllerID,
            "animated": String(animated),
        ])
        // Stop polling the pasteboard when the keyboard leaves the screen
        // (globe to another keyboard, dismissed, host app closed) so we don't
        // run a background timer the user can't see.
        model.stopMonitoring()
    }
}

/// Opt the keyboard into the system key-click sound. `playInputClick()` is a
/// no-op unless the first responder's input view (here, the input view
/// controller) adopts this protocol and returns `true`; iOS still gates the
/// actual sound on the user's global 键盘点击音 setting.
extension KeyboardViewController: UIInputViewAudioFeedback {
    var enableInputClicksWhenVisible: Bool { true }
}
