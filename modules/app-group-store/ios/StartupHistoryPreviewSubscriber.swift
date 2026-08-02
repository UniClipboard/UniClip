import ExpoModulesCore
import Foundation
import UIKit

public final class StartupHistoryPreviewSubscriber: ExpoAppDelegateSubscriber {
  public func customizeRootView(_ rootView: UIView) {
    Self.installPreviewIfAvailable(on: rootView)
  }

  @MainActor
  public static func prepareWindowForReact(_ window: UIWindow) -> Bool {
    guard let items = loadItems() else { return false }

    let controller = UIViewController()
    controller.view.backgroundColor = .systemGroupedBackground
    window.rootViewController = controller
    window.makeKeyAndVisible()
    StartupHistoryPreviewCoordinator.install(items: items, on: controller.view)
    window.layoutIfNeeded()
    window.layer.displayIfNeeded()
    CATransaction.flush()
    return true
  }

  @MainActor
  @discardableResult
  private static func installPreviewIfAvailable(on rootView: UIView) -> Bool {
    guard let items = loadItems() else { return false }
    StartupHistoryPreviewCoordinator.install(items: items, on: rootView)
    return true
  }

  private static func loadItems() -> [StartupHistoryPreviewItem]? {
    let appGroupID = SettingsStore.appGroupID
    guard let containerURL = FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: appGroupID
    ) else {
      return nil
    }

    let databaseURL = containerURL
      .appendingPathComponent("Databases", isDirectory: true)
      .appendingPathComponent("uniclipboard.db", isDirectory: false)
    let items = StartupHistoryPreviewReader(databaseURL: databaseURL).load()
    return items.isEmpty ? nil : items
  }
}

@MainActor
enum StartupHistoryPreviewCoordinator {
  private static weak var previewView: StartupHistoryPreviewView?

  static func install(items: [StartupHistoryPreviewItem], on rootView: UIView) {
    previewView?.removeFromSuperview()

    let preview = StartupHistoryPreviewView(items: items)
    preview.frame = rootView.bounds
    preview.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    rootView.addSubview(preview)
    rootView.layoutIfNeeded()
    preview.setNeedsDisplay()
    preview.layer.displayIfNeeded()
    previewView = preview
  }

  static func dismiss() {
    guard let preview = previewView else { return }
    previewView = nil
    UIView.animate(
      withDuration: 0.10,
      delay: 0,
      options: [.beginFromCurrentState, .curveEaseOut, .allowUserInteraction]
    ) {
      preview.alpha = 0
    } completion: { _ in
      preview.removeFromSuperview()
    }
  }
}

private final class StartupHistoryPreviewView: UIView {
  private let items: [StartupHistoryPreviewItem]

  init(items: [StartupHistoryPreviewItem]) {
    self.items = Array(items.prefix(StartupHistoryPreviewReader.itemLimit))
    super.init(frame: .zero)
    isOpaque = true
    isUserInteractionEnabled = false
    accessibilityIdentifier = "startup-history-preview"
    accessibilityElementsHidden = true
    contentMode = .redraw
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    setNeedsDisplay()
  }

  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    setNeedsDisplay()
  }

  override func draw(_ rect: CGRect) {
    let isDark = traitCollection.userInterfaceStyle == .dark
    let background = UIColor.systemGroupedBackground
    background.setFill()
    UIRectFill(rect)

    let safeTop = max(safeAreaInsets.top, 47)
    drawTopBar(y: safeTop + 4, isDark: isDark)
    drawFilterRow(y: safeTop + 64, isDark: isDark)
    drawCards(y: safeTop + 114, isDark: isDark)
  }

  private func drawTopBar(y: CGFloat, isDark: Bool) {
    let width = bounds.width
    let fill = UIColor.secondarySystemGroupedBackground
    let textColor = UIColor.label

    drawCapsule(CGRect(x: 16, y: y, width: 112, height: 52), fill: fill)
    drawText(
      localized(zh: "我的空间", fallback: "My Space"),
      in: CGRect(x: 31, y: y + 14, width: 76, height: 24),
      font: .systemFont(ofSize: 15, weight: .semibold),
      color: textColor,
      lines: 1
    )
    drawSymbol("chevron.down", in: CGRect(x: 106, y: y + 19, width: 13, height: 13), color: .secondaryLabel)

    let trailing = width - 16
    drawCapsule(CGRect(x: trailing - 200, y: y, width: 72, height: 52), fill: fill)
    drawText(
      localized(zh: "选择", fallback: "Select"),
      in: CGRect(x: trailing - 188, y: y + 14, width: 48, height: 24),
      font: .systemFont(ofSize: 15, weight: .medium),
      color: textColor,
      lines: 1,
      alignment: .center
    )
    drawCircle(CGRect(x: trailing - 116, y: y, width: 52, height: 52), fill: fill)
    drawSymbol("magnifyingglass", in: CGRect(x: trailing - 102, y: y + 14, width: 24, height: 24), color: textColor)
    drawCircle(CGRect(x: trailing - 52, y: y, width: 52, height: 52), fill: fill)
    drawSymbol("ellipsis", in: CGRect(x: trailing - 37, y: y + 15, width: 22, height: 22), color: textColor)
  }

  private func drawFilterRow(y: CGFloat, isDark: Bool) {
    let selectedFill = isDark ? UIColor.white : UIColor.black
    let selectedText = isDark ? UIColor.black : UIColor.white
    let regularFill = UIColor.secondarySystemGroupedBackground
    let regularText = UIColor.label
    let labels = [
      localized(zh: "全部", fallback: "All"),
      localized(zh: "文本", fallback: "Text"),
      localized(zh: "链接", fallback: "Link"),
      localized(zh: "图片", fallback: "Image"),
    ]
    let widths: [CGFloat] = [58, 76, 76, 76]
    var x: CGFloat = 16
    for (index, label) in labels.enumerated() {
      let chip = CGRect(x: x, y: y + 6, width: widths[index], height: 34)
      drawCapsule(chip, fill: index == 0 ? selectedFill : regularFill)
      drawText(
        label,
        in: chip.insetBy(dx: 8, dy: 7),
        font: .systemFont(ofSize: 14, weight: index == 0 ? .semibold : .medium),
        color: index == 0 ? selectedText : regularText,
        lines: 1,
        alignment: .center
      )
      x += widths[index] + 8
    }
  }

  private func drawCards(y: CGFloat, isDark: Bool) {
    let horizontalPadding: CGFloat = 16
    let spacing: CGFloat = 12
    let size = (bounds.width - horizontalPadding * 2 - spacing) / 2
    guard size > 0 else { return }

    for (index, item) in items.enumerated() {
      let row = CGFloat(index / 2)
      let column = CGFloat(index % 2)
      let frame = CGRect(
        x: horizontalPadding + column * (size + spacing),
        y: y + row * (size + spacing),
        width: size,
        height: size
      )
      if frame.minY >= bounds.maxY { break }
      drawCard(item, in: frame, isDark: isDark, isLatest: index == 0)
    }
  }

  private func drawCard(
    _ item: StartupHistoryPreviewItem,
    in frame: CGRect,
    isDark: Bool,
    isLatest: Bool
  ) {
    let path = UIBezierPath(roundedRect: frame, cornerRadius: 14)
    UIColor.secondarySystemGroupedBackground.setFill()
    path.fill()

    let kind = displayKind(for: item)
    let inset = frame.insetBy(dx: 12, dy: 12)
    drawText(
      kindLabel(kind),
      in: CGRect(x: inset.minX, y: inset.minY, width: inset.width * 0.56, height: 16),
      font: .systemFont(ofSize: 11),
      color: .secondaryLabel,
      lines: 1
    )
    drawText(
      relativeTime(item.timestampMs),
      in: CGRect(x: inset.midX, y: inset.minY, width: inset.width / 2, height: 16),
      font: .systemFont(ofSize: 11),
      color: .tertiaryLabel,
      lines: 1,
      alignment: .right
    )

    let content = item.dataName?.isEmpty == false ? item.dataName! : item.text
    drawText(
      content,
      in: CGRect(x: inset.minX, y: inset.minY + 27, width: inset.width, height: inset.height - 54),
      font: .systemFont(ofSize: kind == .text ? 13 : 14, weight: kind == .text ? .regular : .semibold),
      color: .label,
      lines: kind == .text ? 6 : 4
    )

    if item.pinned {
      drawSymbol(
        "pin.fill",
        in: CGRect(x: inset.minX, y: inset.maxY - 13, width: 11, height: 11),
        color: .secondaryLabel
      )
    }
    if isLatest {
      UIColor.systemBlue.setFill()
      UIBezierPath(ovalIn: CGRect(x: inset.maxX - 6, y: inset.maxY - 6, width: 6, height: 6)).fill()
    }
  }

  private enum PreviewKind {
    case text
    case link
    case image
    case file
    case group
  }

  private func displayKind(for item: StartupHistoryPreviewItem) -> PreviewKind {
    switch item.type {
    case "Image": return .image
    case "File": return .file
    case "Group": return .group
    default:
      let text = item.text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
      return text.hasPrefix("https://") || text.hasPrefix("http://") ? .link : .text
    }
  }

  private func kindLabel(_ kind: PreviewKind) -> String {
    switch kind {
    case .text: return localized(zh: "文本", fallback: "Text")
    case .link: return localized(zh: "链接", fallback: "Link")
    case .image: return localized(zh: "图片", fallback: "Image")
    case .file: return localized(zh: "文件", fallback: "File")
    case .group: return localized(zh: "文件组", fallback: "Files")
    }
  }

  private func relativeTime(_ timestampMs: Int64) -> String {
    let elapsed = max(0, Int64(Date().timeIntervalSince1970 * 1_000) - timestampMs)
    if elapsed < 60_000 { return localized(zh: "刚刚", fallback: "Now") }
    if elapsed < 3_600_000 {
      let value = max(1, elapsed / 60_000)
      return localized(zh: "\(value) 分钟", fallback: "\(value)m")
    }
    if elapsed < 86_400_000 {
      let value = max(1, elapsed / 3_600_000)
      return localized(zh: "\(value) 小时", fallback: "\(value)h")
    }
    let value = max(1, elapsed / 86_400_000)
    return localized(zh: "\(value) 天", fallback: "\(value)d")
  }

  private func localized(zh: String, fallback: String) -> String {
    Locale.preferredLanguages.first?.hasPrefix("zh") == true ? zh : fallback
  }

  private func drawCapsule(_ rect: CGRect, fill: UIColor) {
    fill.setFill()
    UIBezierPath(roundedRect: rect, cornerRadius: rect.height / 2).fill()
  }

  private func drawCircle(_ rect: CGRect, fill: UIColor) {
    fill.setFill()
    UIBezierPath(ovalIn: rect).fill()
  }

  private func drawSymbol(_ name: String, in rect: CGRect, color: UIColor) {
    guard let image = UIImage(systemName: name)?.withTintColor(color, renderingMode: .alwaysOriginal) else {
      return
    }
    image.draw(in: rect)
  }

  private func drawText(
    _ value: String,
    in rect: CGRect,
    font: UIFont,
    color: UIColor,
    lines: Int,
    alignment: NSTextAlignment = .left
  ) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = alignment
    paragraph.lineBreakMode = .byTruncatingTail
    paragraph.maximumLineHeight = font.lineHeight
    let attributes: [NSAttributedString.Key: Any] = [
      .font: font,
      .foregroundColor: color,
      .paragraphStyle: paragraph,
    ]
    let height = min(rect.height, ceil(font.lineHeight * CGFloat(max(1, lines))))
    (value as NSString).draw(
      with: CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: height),
      options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
      attributes: attributes,
      context: nil
    )
  }
}
