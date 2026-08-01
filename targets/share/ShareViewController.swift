import UIKit
import SwiftUI

/// Principal class for the Share Extension. iOS instantiates this when the
/// user picks UniClipboard from the system share sheet. We don't subclass
/// `SLComposeServiceViewController` — that gives a Twitter-style compose
/// UI that doesn't fit our flow (recipient picker + content preview + send).
/// Instead we host our own SwiftUI sheet inside a plain `UIViewController`.
final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()

        SentryBootstrap.start()

        let context = self.extensionContext
        let root = ShareRootView(
            context: context.map(ShareExtensionContext.init),
            onFinish: { [weak self] in
                self?.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
            },
            onCancel: { [weak self] in
                self?.extensionContext?.cancelRequest(withError: NSError(
                    domain: NSCocoaErrorDomain,
                    code: NSUserCancelledError
                ))
            }
        )

        let host = UIHostingController(rootView: root)
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        host.didMove(toParent: self)
    }
}

/// Thin wrapper around `NSExtensionContext` so the SwiftUI view doesn't
/// reach into UIKit for attachment loading. Bridges the host VC's context
/// into the value-typed world; the view holds it as an `Optional` so the
/// SwiftUI preview can pass `nil`.
struct ShareExtensionContext {
    let inputItems: [NSExtensionItem]

    init(_ context: NSExtensionContext) {
        self.inputItems = context.inputItems.compactMap { $0 as? NSExtensionItem }
    }
}
