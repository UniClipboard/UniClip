import ExpoModulesCore
import VisionKit

public class QrScannerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("QrScanner")

    AsyncFunction("scanQRCode") { (promise: Promise) in
      if #available(iOS 16.0, *) {
        Task { @MainActor in
          guard DataScannerViewController.isSupported,
                DataScannerViewController.isAvailable else {
            promise.reject("UNSUPPORTED", "Device does not support DataScanner")
            return
          }
          self.presentScanner(promise: promise)
        }
      } else {
        promise.reject("UNSUPPORTED", "Requires iOS 16+")
      }
    }
  }

  @available(iOS 16.0, *)
  @MainActor
  private func presentScanner(promise: Promise) {
    guard let rootVC = UIApplication.shared
      .connectedScenes
      .compactMap({ $0 as? UIWindowScene })
      .flatMap({ $0.windows })
      .first(where: { $0.isKeyWindow })?
      .rootViewController else {
      promise.reject("NO_VC", "Cannot find root view controller")
      return
    }

    var topVC = rootVC
    while let presented = topVC.presentedViewController {
      topVC = presented
    }

    let scanner = DataScannerViewController(
      recognizedDataTypes: [.barcode(symbologies: [.qr])],
      qualityLevel: .balanced,
      recognizesMultipleItems: false,
      isHighlightingEnabled: true
    )

    let coordinator = ScanCoordinator(promise: promise, scanner: scanner)
    scanner.delegate = coordinator

    objc_setAssociatedObject(scanner, "coordinator", coordinator, .OBJC_ASSOCIATION_RETAIN)

    scanner.modalPresentationStyle = .fullScreen

    topVC.present(scanner, animated: true) {
      try? scanner.startScanning()
      coordinator.addOverlay()
    }
  }
}

@available(iOS 16.0, *)
@MainActor
private class ScanCoordinator: NSObject, DataScannerViewControllerDelegate {
  private let promise: Promise
  private let scanner: DataScannerViewController
  private var fired = false

  init(promise: Promise, scanner: DataScannerViewController) {
    self.promise = promise
    self.scanner = scanner
  }

  func addOverlay() {
    let overlay = scanner.overlayContainerView

    // ── Cancel button (top-left) ──
    let cancelBtn = UIButton(type: .system)
    cancelBtn.setTitle("取消", for: .normal)
    cancelBtn.titleLabel?.font = .systemFont(ofSize: 17, weight: .regular)
    cancelBtn.setTitleColor(.white, for: .normal)
    cancelBtn.backgroundColor = UIColor.white.withAlphaComponent(0.15)
    cancelBtn.layer.cornerRadius = 18
    cancelBtn.clipsToBounds = true

    let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
    blur.isUserInteractionEnabled = false
    blur.layer.cornerRadius = 18
    blur.clipsToBounds = true
    cancelBtn.insertSubview(blur, at: 0)
    blur.translatesAutoresizingMaskIntoConstraints = false

    cancelBtn.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
    cancelBtn.translatesAutoresizingMaskIntoConstraints = false
    scanner.view.addSubview(cancelBtn)

    // ── Reticle (center) ──
    let reticleSize: CGFloat = 240
    let reticle = ReticleView(frame: .zero)
    reticle.translatesAutoresizingMaskIntoConstraints = false
    reticle.isUserInteractionEnabled = false
    overlay.addSubview(reticle)

    // ── Hint text (below reticle) ──
    let hint = UILabel()
    hint.text = "将服务器二维码对准框内"
    hint.textColor = UIColor.white.withAlphaComponent(0.85)
    hint.font = .systemFont(ofSize: 15)
    hint.translatesAutoresizingMaskIntoConstraints = false
    overlay.addSubview(hint)

    NSLayoutConstraint.activate([
      cancelBtn.topAnchor.constraint(equalTo: scanner.view.safeAreaLayoutGuide.topAnchor, constant: 12),
      cancelBtn.leadingAnchor.constraint(equalTo: scanner.view.leadingAnchor, constant: 20),
      cancelBtn.widthAnchor.constraint(equalToConstant: 64),
      cancelBtn.heightAnchor.constraint(equalToConstant: 36),

      blur.topAnchor.constraint(equalTo: cancelBtn.topAnchor),
      blur.bottomAnchor.constraint(equalTo: cancelBtn.bottomAnchor),
      blur.leadingAnchor.constraint(equalTo: cancelBtn.leadingAnchor),
      blur.trailingAnchor.constraint(equalTo: cancelBtn.trailingAnchor),

      reticle.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
      reticle.centerYAnchor.constraint(equalTo: overlay.centerYAnchor, constant: -30),
      reticle.widthAnchor.constraint(equalToConstant: reticleSize),
      reticle.heightAnchor.constraint(equalToConstant: reticleSize),

      hint.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
      hint.topAnchor.constraint(equalTo: reticle.bottomAnchor, constant: 24),
    ])
  }

  @objc private func cancelTapped() {
    guard !fired else { return }
    fired = true
    scanner.stopScanning()
    scanner.dismiss(animated: true) {
      self.promise.resolve(nil)
    }
  }

  func dataScanner(_ dataScanner: DataScannerViewController, didTapOn item: RecognizedItem) {
    guard !fired else { return }
    if case .barcode(let barcode) = item, let value = barcode.payloadStringValue {
      fired = true
      scanner.stopScanning()
      scanner.dismiss(animated: true) {
        self.promise.resolve(value)
      }
    }
  }

  func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
    guard !fired else { return }
    for item in addedItems {
      if case .barcode(let barcode) = item, let value = barcode.payloadStringValue {
        fired = true
        scanner.stopScanning()
        scanner.dismiss(animated: true) {
          self.promise.resolve(value)
        }
        return
      }
    }
  }

  nonisolated func dataScannerDidCancel(_ dataScanner: DataScannerViewController) {
    Task { @MainActor in
      guard !fired else { return }
      fired = true
      promise.resolve(nil)
    }
  }
}

/// Rounded-corner reticle with four corner brackets
private class ReticleView: UIView {
  private let cornerLength: CGFloat = 28
  private let lineWidth: CGFloat = 3
  private let cornerRadius: CGFloat = 18

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .clear
  }

  required init?(coder: NSCoder) { fatalError() }

  override func draw(_ rect: CGRect) {
    guard let ctx = UIGraphicsGetCurrentContext() else { return }
    let color = UIColor.white.cgColor
    ctx.setStrokeColor(color)
    ctx.setLineWidth(lineWidth)
    ctx.setLineCap(.round)

    let insetRect = rect.insetBy(dx: lineWidth / 2, dy: lineWidth / 2)
    let cornerSpan = cornerLength

    // Top-left
    ctx.move(to: CGPoint(x: insetRect.minX, y: insetRect.minY + cornerSpan))
    ctx.addArc(tangent1End: CGPoint(x: insetRect.minX, y: insetRect.minY),
               tangent2End: CGPoint(x: insetRect.minX + cornerSpan, y: insetRect.minY),
               radius: cornerRadius)
    ctx.addLine(to: CGPoint(x: insetRect.minX + cornerSpan, y: insetRect.minY))
    ctx.strokePath()

    // Top-right
    ctx.move(to: CGPoint(x: insetRect.maxX - cornerSpan, y: insetRect.minY))
    ctx.addArc(tangent1End: CGPoint(x: insetRect.maxX, y: insetRect.minY),
               tangent2End: CGPoint(x: insetRect.maxX, y: insetRect.minY + cornerSpan),
               radius: cornerRadius)
    ctx.addLine(to: CGPoint(x: insetRect.maxX, y: insetRect.minY + cornerSpan))
    ctx.strokePath()

    // Bottom-left
    ctx.move(to: CGPoint(x: insetRect.minX, y: insetRect.maxY - cornerSpan))
    ctx.addArc(tangent1End: CGPoint(x: insetRect.minX, y: insetRect.maxY),
               tangent2End: CGPoint(x: insetRect.minX + cornerSpan, y: insetRect.maxY),
               radius: cornerRadius)
    ctx.addLine(to: CGPoint(x: insetRect.minX + cornerSpan, y: insetRect.maxY))
    ctx.strokePath()

    // Bottom-right
    ctx.move(to: CGPoint(x: insetRect.maxX - cornerSpan, y: insetRect.maxY))
    ctx.addArc(tangent1End: CGPoint(x: insetRect.maxX, y: insetRect.maxY),
               tangent2End: CGPoint(x: insetRect.maxX, y: insetRect.maxY - cornerSpan),
               radius: cornerRadius)
    ctx.addLine(to: CGPoint(x: insetRect.maxX, y: insetRect.maxY - cornerSpan))
    ctx.strokePath()
  }
}
