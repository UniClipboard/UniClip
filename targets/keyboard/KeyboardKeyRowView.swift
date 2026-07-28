import UIKit

@MainActor
final class KeyboardKeyRowView: UIView {
    var onInsertSpace: (() -> Void)?
    var onInsertReturn: (() -> Void)?
    var onDeleteBackward: ((Bool) -> Void)?
    var onAdvanceInputMode: (() -> Void)?

    private let keyRowBand = UIView()
    private let keyRow = UIStackView()
    private let rightKeyRow = UIStackView()
    private let spaceButton = UIButton(type: .system)
    private let deleteButton = KeyboardRepeatButton(type: .system)
    private let returnButton = UIButton(type: .system)
    private let globeBand = UIView()
    private let globeButton = UIButton(type: .system)
    private var deleteRepeatTask: Task<Void, Never>?

    override init(frame: CGRect) {
        super.init(frame: frame)
        buildHierarchy()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    deinit { deleteRepeatTask?.cancel() }

    func render(layout: KeyboardViewState.Layout, strings: KeyboardViewState.Strings) {
        keyRowBand.isHidden = !layout.hasFullAccess
        globeBand.isHidden = !layout.needsInputModeSwitchKey
        globeButton.accessibilityLabel = strings.globeLabel
        deleteButton.accessibilityLabel = strings.deleteLabel
        returnButton.accessibilityLabel = strings.returnLabel
        spaceButton.setTitle(strings.spaceTitle, for: .normal)
        returnButton.setTitle(layout.returnKeyTitle, for: .normal)
        returnButton.setImage(layout.returnKeyTitle == nil ? UIImage(systemName: "return") : nil, for: .normal)
    }

    private func buildHierarchy() {
        translatesAutoresizingMaskIntoConstraints = false
        let stack = UIStackView(arrangedSubviews: [keyRowBand, globeBand])
        stack.axis = .vertical
        stack.spacing = 0
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor),
            stack.topAnchor.constraint(equalTo: topAnchor),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor),
            keyRowBand.heightAnchor.constraint(
                equalToConstant: KeyboardLayoutMetrics.keyRowTopPad
                    + KeyboardLayoutMetrics.keyRowHeight
                    + KeyboardLayoutMetrics.keyRowBottomPad
            ),
            globeBand.heightAnchor.constraint(equalToConstant: KeyboardLayoutMetrics.stripBandHeight),
        ])
        buildKeyRow()
        buildGlobeBand()
    }

    private func buildKeyRow() {
        keyRowBand.backgroundColor = .clear
        keyRow.axis = .horizontal
        keyRow.spacing = 7
        keyRow.translatesAutoresizingMaskIntoConstraints = false
        rightKeyRow.axis = .horizontal
        rightKeyRow.spacing = 7
        rightKeyRow.distribution = .fillEqually
        configureKeyButton(spaceButton)
        configureKeyButton(deleteButton)
        configureKeyButton(returnButton, emphasized: true)
        spaceButton.addTarget(self, action: #selector(insertSpace), for: .touchUpInside)
        returnButton.addTarget(self, action: #selector(insertReturn), for: .touchUpInside)
        deleteButton.onTouchDown = { [weak self] in self?.startDeleting() }
        deleteButton.onTouchUp = { [weak self] in self?.stopDeleting() }
        rightKeyRow.addArrangedSubview(deleteButton)
        rightKeyRow.addArrangedSubview(returnButton)
        keyRow.addArrangedSubview(spaceButton)
        keyRow.addArrangedSubview(rightKeyRow)
        spaceButton.widthAnchor.constraint(equalTo: rightKeyRow.widthAnchor).isActive = true
        keyRowBand.addSubview(keyRow)
        NSLayoutConstraint.activate([
            keyRow.leadingAnchor.constraint(equalTo: keyRowBand.leadingAnchor, constant: KeyboardLayoutMetrics.hMargin),
            keyRow.trailingAnchor.constraint(equalTo: keyRowBand.trailingAnchor, constant: -KeyboardLayoutMetrics.hMargin),
            keyRow.topAnchor.constraint(equalTo: keyRowBand.topAnchor, constant: KeyboardLayoutMetrics.keyRowTopPad),
            keyRow.heightAnchor.constraint(equalToConstant: KeyboardLayoutMetrics.keyRowHeight),
        ])
    }

    private func buildGlobeBand() {
        globeBand.backgroundColor = .clear
        configureIconButton(
            globeButton,
            symbol: "globe",
            symbolSize: KeyboardLayoutMetrics.isPad ? 19 : 16,
            width: KeyboardLayoutMetrics.globeSize,
            height: KeyboardLayoutMetrics.stripHeight
        )
        globeButton.addTarget(self, action: #selector(advanceInputMode), for: .touchUpInside)
        globeBand.addSubview(globeButton)
        NSLayoutConstraint.activate([
            globeButton.leadingAnchor.constraint(equalTo: globeBand.leadingAnchor, constant: KeyboardLayoutMetrics.hMargin),
            globeButton.topAnchor.constraint(equalTo: globeBand.topAnchor, constant: KeyboardLayoutMetrics.stripTopPad),
        ])
    }

    private func configureKeyButton(_ button: UIButton, emphasized: Bool = false) {
        button.translatesAutoresizingMaskIntoConstraints = false
        button.titleLabel?.font = emphasized
            ? .preferredFont(forTextStyle: .callout).withWeight(.semibold)
            : .preferredFont(forTextStyle: .callout)
        button.setTitleColor(emphasized ? .white : .secondaryLabel, for: .normal)
        button.tintColor = emphasized ? .white : .label
        button.backgroundColor = emphasized ? .systemBlue : KeyboardSurface.itemUIColor
        button.layer.cornerRadius = 9
        button.layer.cornerCurve = .continuous
    }

    private func configureIconButton(
        _ button: UIButton,
        symbol: String,
        symbolSize: CGFloat,
        width: CGFloat,
        height: CGFloat
    ) {
        button.translatesAutoresizingMaskIntoConstraints = false
        button.setImage(UIImage(systemName: symbol), for: .normal)
        button.tintColor = .secondaryLabel
        button.imageView?.preferredSymbolConfiguration = UIImage.SymbolConfiguration(
            pointSize: symbolSize,
            weight: .medium
        )
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(equalToConstant: width),
            button.heightAnchor.constraint(equalToConstant: height),
        ])
    }

    @objc private func insertSpace() { onInsertSpace?() }
    @objc private func insertReturn() { onInsertReturn?() }
    @objc private func advanceInputMode() { onAdvanceInputMode?() }

    private func startDeleting() {
        deleteRepeatTask?.cancel()
        deleteRepeatTask = Task { @MainActor [weak self] in
            guard let self else { return }
            onDeleteBackward?(false)
            try? await Task.sleep(for: .seconds(0.45))
            var interval = 0.11
            var count = 0
            while !Task.isCancelled, count < 600 {
                onDeleteBackward?(true)
                count += 1
                try? await Task.sleep(for: .seconds(interval))
                interval = max(0.035, interval * 0.90)
            }
        }
    }

    private func stopDeleting() {
        deleteRepeatTask?.cancel()
        deleteRepeatTask = nil
    }
}

@MainActor
private final class KeyboardRepeatButton: UIButton {
    var onTouchDown: (() -> Void)?
    var onTouchUp: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        addTarget(self, action: #selector(touchDown), for: .touchDown)
        addTarget(
            self,
            action: #selector(touchUp),
            for: [.touchUpInside, .touchUpOutside, .touchCancel, .touchDragExit]
        )
        setImage(UIImage(systemName: "delete.left"), for: .normal)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    @objc private func touchDown() { onTouchDown?() }
    @objc private func touchUp() { onTouchUp?() }
}
