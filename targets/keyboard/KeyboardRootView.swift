import Combine
import UIKit
internal import UcEngineCore

enum KeyboardLayout {
    static let isPad = UIDevice.current.userInterfaceIdiom == .pad
    static let topBarHeight: CGFloat = 38
    static let topBarVPad: CGFloat = 4
    static let hMargin: CGFloat = 12
    static let cardHeight: CGFloat = 150
    static let cardWidth: CGFloat = 152
    static let cardSpacing: CGFloat = 12
    static let cardRowVPad: CGFloat = 4
    static let keyRowHeight: CGFloat = 46
    static let keyRowTopPad: CGFloat = 4
    static let keyRowBottomPad: CGFloat = isPad ? 14 : 4
    static let globeSize: CGFloat = isPad ? 34 : 28
    static let stripHeight: CGFloat = isPad ? 34 : 30
    static let stripTopPad: CGFloat = isPad ? 6 : 2
    static let stripBottomPad: CGFloat = isPad ? 12 : 8

    static var contentHeight: CGFloat {
        topBarHeight + topBarVPad * 2
            + cardHeight + cardRowVPad * 2
            + keyRowTopPad + keyRowHeight + keyRowBottomPad
    }

    static var restrictedContentHeight: CGFloat {
        contentHeight - keyRowTopPad - keyRowHeight - keyRowBottomPad
    }

    static var stripBandHeight: CGFloat {
        stripTopPad + stripHeight + stripBottomPad
    }
}

enum KeyboardSurface {
    static let trayUIColor = UIColor.systemGray5
    static let itemUIColor = UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(white: 0.34, alpha: 1)
            : .white
    }
}

@MainActor
final class KeyboardRootView: UIView {
    var onPreferredHeightChange: ((CGFloat) -> Void)?
    var onOpenSettings: ((URL) -> Void)?

    private enum Filter: Int, CaseIterable {
        case all
        case text
        case link
        case image

        func matches(_ card: KeyboardModel.Card) -> Bool {
            switch self {
            case .all: true
            case .text: card.kind == .text
            case .link: card.kind == .link
            case .image: card.kind == .image
            }
        }
    }

    private enum Section: Hashable { case main }

    private let model: KeyboardModel
    private var cancellables = Set<AnyCancellable>()
    private var filter: Filter = .all
    private var isFiltering = false
    private var displayedCards: [KeyboardModel.Card] = []
    private var cardsByID: [UUID: KeyboardModel.Card] = [:]
    private var deleteRepeatTask: Task<Void, Never>?

    private let rootStack = UIStackView()
    private let topBar = UIView()
    private let standardTopBar = UIView()
    private let filterTopBar = UIView()
    private let searchButton = UIButton(type: .system)
    private let serverButton = UIButton(type: .system)
    private let refreshButton = UIButton(type: .system)
    private let refreshSpinner = UIActivityIndicatorView(style: .medium)
    private let closeFilterButton = UIButton(type: .system)
    private let filterControl = UISegmentedControl(items: [])
    private let cardArea = UIView()
    private let stateView = KeyboardStateView()
    private let keyRowBand = UIView()
    private let keyRow = UIStackView()
    private let rightKeyRow = UIStackView()
    private let spaceButton = UIButton(type: .system)
    private let deleteButton = KeyboardRepeatButton(type: .system)
    private let returnButton = UIButton(type: .system)
    private let globeBand = UIView()
    private let globeButton = UIButton(type: .system)

    private lazy var collectionView: UICollectionView = {
        let layout = UICollectionViewFlowLayout()
        layout.scrollDirection = .horizontal
        layout.itemSize = CGSize(width: KeyboardLayout.cardWidth, height: KeyboardLayout.cardHeight)
        layout.minimumLineSpacing = KeyboardLayout.cardSpacing
        layout.minimumInteritemSpacing = KeyboardLayout.cardSpacing
        layout.sectionInset = UIEdgeInsets(
            top: KeyboardLayout.cardRowVPad,
            left: KeyboardLayout.hMargin,
            bottom: KeyboardLayout.cardRowVPad,
            right: KeyboardLayout.hMargin
        )
        let view = UICollectionView(frame: .zero, collectionViewLayout: layout)
        view.translatesAutoresizingMaskIntoConstraints = false
        view.backgroundColor = .clear
        view.showsHorizontalScrollIndicator = false
        view.alwaysBounceHorizontal = true
        view.decelerationRate = .fast
        view.delegate = self
        view.register(KeyboardCardCell.self, forCellWithReuseIdentifier: KeyboardCardCell.reuseIdentifier)
        return view
    }()

    private lazy var dataSource = UICollectionViewDiffableDataSource<Section, UUID>(
        collectionView: collectionView
    ) { [weak self] collectionView, indexPath, id in
        guard let self,
              let card = self.cardsByID[id],
              let cell = collectionView.dequeueReusableCell(
                  withReuseIdentifier: KeyboardCardCell.reuseIdentifier,
                  for: indexPath
              ) as? KeyboardCardCell else { return UICollectionViewCell() }
        cell.configure(
            model: self.model,
            card: card,
            isActing: self.model.cardActionPresentation.actingCardID == id,
            didAct: self.model.cardActionPresentation.actedCardID == id
        )
        return cell
    }

    init(model: KeyboardModel) {
        self.model = model
        super.init(frame: .zero)
        isOpaque = true
        backgroundColor = KeyboardSurface.trayUIColor
        buildHierarchy()
        bindModel()
        renderAll()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    deinit { deleteRepeatTask?.cancel() }

    override var intrinsicContentSize: CGSize {
        CGSize(width: UIView.noIntrinsicMetric, height: preferredHeight)
    }

    var preferredHeight: CGFloat {
        let layout = model.layoutPresentation
        let content = layout.hasFullAccess
            ? KeyboardLayout.contentHeight
            : KeyboardLayout.restrictedContentHeight
        return content + (layout.needsInputModeSwitchKey ? KeyboardLayout.stripBandHeight : 0)
    }

    private func buildHierarchy() {
        translatesAutoresizingMaskIntoConstraints = false
        rootStack.axis = .vertical
        rootStack.spacing = 0
        rootStack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(rootStack)
        NSLayoutConstraint.activate([
            rootStack.leadingAnchor.constraint(equalTo: leadingAnchor),
            rootStack.trailingAnchor.constraint(equalTo: trailingAnchor),
            rootStack.topAnchor.constraint(equalTo: topAnchor),
            rootStack.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])

        buildTopBar()
        buildCardArea()
        buildKeyRow()
        buildGlobeBand()

        rootStack.addArrangedSubview(topBar)
        rootStack.addArrangedSubview(cardArea)
        rootStack.addArrangedSubview(keyRowBand)
        rootStack.addArrangedSubview(globeBand)
        topBar.heightAnchor.constraint(
            equalToConstant: KeyboardLayout.topBarHeight + KeyboardLayout.topBarVPad * 2
        ).isActive = true
        cardArea.heightAnchor.constraint(
            equalToConstant: KeyboardLayout.cardHeight + KeyboardLayout.cardRowVPad * 2
        ).isActive = true
        keyRowBand.heightAnchor.constraint(
            equalToConstant: KeyboardLayout.keyRowTopPad
                + KeyboardLayout.keyRowHeight
                + KeyboardLayout.keyRowBottomPad
        ).isActive = true
        globeBand.heightAnchor.constraint(equalToConstant: KeyboardLayout.stripBandHeight).isActive = true
    }

    private func buildTopBar() {
        topBar.backgroundColor = .clear
        [standardTopBar, filterTopBar].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            topBar.addSubview($0)
            NSLayoutConstraint.activate([
                $0.leadingAnchor.constraint(equalTo: topBar.leadingAnchor, constant: KeyboardLayout.hMargin),
                $0.trailingAnchor.constraint(equalTo: topBar.trailingAnchor, constant: -KeyboardLayout.hMargin),
                $0.topAnchor.constraint(equalTo: topBar.topAnchor, constant: KeyboardLayout.topBarVPad),
                $0.bottomAnchor.constraint(equalTo: topBar.bottomAnchor, constant: -KeyboardLayout.topBarVPad),
            ])
        }

        configureIconButton(searchButton, symbol: "magnifyingglass")
        configureIconButton(refreshButton, symbol: "arrow.clockwise")
        configureIconButton(closeFilterButton, symbol: "xmark")
        searchButton.addTarget(self, action: #selector(openFilter), for: .touchUpInside)
        refreshButton.addTarget(self, action: #selector(refresh), for: .touchUpInside)
        closeFilterButton.addTarget(self, action: #selector(closeFilter), for: .touchUpInside)

        serverButton.translatesAutoresizingMaskIntoConstraints = false
        serverButton.titleLabel?.font = .preferredFont(forTextStyle: .subheadline).withWeight(.semibold)
        serverButton.setTitleColor(.label, for: .normal)
        serverButton.showsMenuAsPrimaryAction = true

        refreshSpinner.translatesAutoresizingMaskIntoConstraints = false
        refreshSpinner.hidesWhenStopped = true
        standardTopBar.addSubview(searchButton)
        standardTopBar.addSubview(serverButton)
        standardTopBar.addSubview(refreshButton)
        standardTopBar.addSubview(refreshSpinner)
        NSLayoutConstraint.activate([
            searchButton.leadingAnchor.constraint(equalTo: standardTopBar.leadingAnchor),
            searchButton.centerYAnchor.constraint(equalTo: standardTopBar.centerYAnchor),
            serverButton.centerXAnchor.constraint(equalTo: standardTopBar.centerXAnchor),
            serverButton.centerYAnchor.constraint(equalTo: standardTopBar.centerYAnchor),
            serverButton.leadingAnchor.constraint(greaterThanOrEqualTo: searchButton.trailingAnchor, constant: 8),
            serverButton.trailingAnchor.constraint(lessThanOrEqualTo: refreshButton.leadingAnchor, constant: -8),
            refreshButton.trailingAnchor.constraint(equalTo: standardTopBar.trailingAnchor),
            refreshButton.centerYAnchor.constraint(equalTo: standardTopBar.centerYAnchor),
            refreshSpinner.centerXAnchor.constraint(equalTo: refreshButton.centerXAnchor),
            refreshSpinner.centerYAnchor.constraint(equalTo: refreshButton.centerYAnchor),
        ])

        closeFilterButton.translatesAutoresizingMaskIntoConstraints = false
        filterControl.translatesAutoresizingMaskIntoConstraints = false
        filterControl.addTarget(self, action: #selector(filterChanged), for: .valueChanged)
        filterTopBar.addSubview(closeFilterButton)
        filterTopBar.addSubview(filterControl)
        NSLayoutConstraint.activate([
            closeFilterButton.leadingAnchor.constraint(equalTo: filterTopBar.leadingAnchor),
            closeFilterButton.centerYAnchor.constraint(equalTo: filterTopBar.centerYAnchor),
            filterControl.leadingAnchor.constraint(equalTo: closeFilterButton.trailingAnchor, constant: 8),
            filterControl.trailingAnchor.constraint(lessThanOrEqualTo: filterTopBar.trailingAnchor),
            filterControl.centerYAnchor.constraint(equalTo: filterTopBar.centerYAnchor),
        ])
        filterTopBar.isHidden = true
    }

    private func buildCardArea() {
        cardArea.backgroundColor = .clear
        cardArea.addSubview(collectionView)
        stateView.translatesAutoresizingMaskIntoConstraints = false
        cardArea.addSubview(stateView)
        NSLayoutConstraint.activate([
            collectionView.leadingAnchor.constraint(equalTo: cardArea.leadingAnchor),
            collectionView.trailingAnchor.constraint(equalTo: cardArea.trailingAnchor),
            collectionView.topAnchor.constraint(equalTo: cardArea.topAnchor),
            collectionView.bottomAnchor.constraint(equalTo: cardArea.bottomAnchor),
            stateView.leadingAnchor.constraint(equalTo: cardArea.leadingAnchor, constant: KeyboardLayout.hMargin),
            stateView.trailingAnchor.constraint(equalTo: cardArea.trailingAnchor, constant: -KeyboardLayout.hMargin),
            stateView.topAnchor.constraint(equalTo: cardArea.topAnchor),
            stateView.bottomAnchor.constraint(equalTo: cardArea.bottomAnchor),
        ])
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
            keyRow.leadingAnchor.constraint(equalTo: keyRowBand.leadingAnchor, constant: KeyboardLayout.hMargin),
            keyRow.trailingAnchor.constraint(equalTo: keyRowBand.trailingAnchor, constant: -KeyboardLayout.hMargin),
            keyRow.topAnchor.constraint(equalTo: keyRowBand.topAnchor, constant: KeyboardLayout.keyRowTopPad),
            keyRow.heightAnchor.constraint(equalToConstant: KeyboardLayout.keyRowHeight),
        ])
    }

    private func buildGlobeBand() {
        globeBand.backgroundColor = .clear
        configureIconButton(
            globeButton,
            symbol: "globe",
            symbolSize: KeyboardLayout.isPad ? 19 : 16,
            width: KeyboardLayout.globeSize,
            height: KeyboardLayout.stripHeight
        )
        globeButton.addTarget(self, action: #selector(advanceInputMode), for: .touchUpInside)
        globeBand.addSubview(globeButton)
        NSLayoutConstraint.activate([
            globeButton.leadingAnchor.constraint(equalTo: globeBand.leadingAnchor, constant: KeyboardLayout.hMargin),
            globeButton.topAnchor.constraint(equalTo: globeBand.topAnchor, constant: KeyboardLayout.stripTopPad),
        ])
    }

    private func bindModel() {
        let layout = model.layoutPresentation
        layout.$hasFullAccess.sink { [weak self] _ in self?.renderLayout() }.store(in: &cancellables)
        layout.$needsInputModeSwitchKey.sink { [weak self] _ in self?.renderLayout() }.store(in: &cancellables)
        layout.$localization.sink { [weak self] _ in self?.renderLocalizedText() }.store(in: &cancellables)
        layout.$returnKeyTitle.sink { [weak self] _ in self?.renderReturnKey() }.store(in: &cancellables)

        let top = model.topBarPresentation
        top.$gate.sink { [weak self] _ in self?.renderTopBar() }.store(in: &cancellables)
        top.$hasCards.sink { [weak self] _ in self?.renderTopBar() }.store(in: &cancellables)
        top.$serverLabel.sink { [weak self] _ in self?.renderTopBar() }.store(in: &cancellables)

        let cards = model.cardListPresentation
        Publishers.CombineLatest3(cards.$gate, cards.$lastError, cards.$cards)
            .sink { [weak self] gate, lastError, cards in
                self?.renderCards(gate: gate, lastError: lastError, cards: cards)
            }
            .store(in: &cancellables)

        let actions = model.cardActionPresentation
        actions.$actingCardID.sink { [weak self] _ in self?.renderCardActions() }.store(in: &cancellables)
        actions.$actedCardID.sink { [weak self] _ in self?.renderCardActions() }.store(in: &cancellables)

        let sync = model.syncPresentation
        sync.$isSyncing.sink { [weak self] _ in self?.renderSyncButton() }.store(in: &cancellables)
        sync.$flash.sink { [weak self] _ in self?.renderSyncButton() }.store(in: &cancellables)
    }

    private func renderAll() {
        renderLocalizedText()
        renderLayout()
        renderTopBar()
        renderCards()
        renderSyncButton()
        renderCardActions()
    }

    private func renderLayout() {
        let layout = model.layoutPresentation
        keyRowBand.isHidden = !layout.hasFullAccess
        globeBand.isHidden = !layout.needsInputModeSwitchKey
        invalidateIntrinsicContentSize()
        onPreferredHeightChange?(preferredHeight)
        KeyboardDiagnostics.shared.record("view.render", fields: [
            "surface": "layout",
            "height": String(format: "%.1f", preferredHeight),
        ])
    }

    private func renderLocalizedText() {
        let localize = model.localization.string
        searchButton.accessibilityLabel = localize("筛选")
        refreshButton.accessibilityLabel = localize("刷新")
        closeFilterButton.accessibilityLabel = localize("关闭筛选")
        serverButton.accessibilityLabel = localize("切换服务器")
        globeButton.accessibilityLabel = localize("切换键盘")
        deleteButton.accessibilityLabel = localize("删除")
        returnButton.accessibilityLabel = localize("回车")
        spaceButton.setTitle(localize("空格"), for: .normal)
        rebuildFilterSegments()
        renderReturnKey()
        renderTopBar()
        renderCards()
    }

    private func renderReturnKey() {
        let title = model.layoutPresentation.returnKeyTitle
        returnButton.setTitle(title, for: .normal)
        returnButton.setImage(title == nil ? UIImage(systemName: "return") : nil, for: .normal)
    }

    private func renderTopBar() {
        let presentation = model.topBarPresentation
        searchButton.isHidden = presentation.gate == .needsFullAccess || !presentation.hasCards
        refreshButton.isHidden = presentation.gate == .needsFullAccess
        refreshSpinner.isHidden = presentation.gate == .needsFullAccess
        let title = presentation.gate == .ok && !presentation.serverLabel.isEmpty
            ? presentation.serverLabel
            : "UniClip"
        serverButton.setTitle(title + (presentation.gate == .ok ? " ⌄" : ""), for: .normal)
        serverButton.isEnabled = presentation.gate == .ok
        rebuildServerMenu()
    }

    private func renderCards() {
        let presentation = model.cardListPresentation
        renderCards(
            gate: presentation.gate,
            lastError: presentation.lastError,
            cards: presentation.cards
        )
    }

    private func renderCards(
        gate: KeyboardModel.Gate,
        lastError: String?,
        cards: [KeyboardModel.Card]
    ) {
        if gate == .needsFullAccess {
            collectionView.isHidden = true
            stateView.isHidden = false
            stateView.configure(
                symbol: "lock.shield",
                title: model.localization.string("需要「完全访问权限」"),
                message: model.localization.string(
                    "在 设置 › 通用 › 键盘 › UniClip 中开启「允许完全访问」,即可在打开键盘时自动同步剪贴板。"
                ),
                actionTitle: KeyboardSettingsURL.destination == nil
                    ? nil
                    : model.localization.string("前往设置 ›")
            ) { [weak self] in
                guard let self, let url = KeyboardSettingsURL.destination else { return }
                self.onOpenSettings?(url)
            }
            return
        }

        displayedCards = isFiltering ? cards.filter(filter.matches) : cards
        if !displayedCards.isEmpty {
            stateView.isHidden = true
            collectionView.isHidden = false
            cardsByID = Dictionary(uniqueKeysWithValues: displayedCards.map { ($0.id, $0) })
            var snapshot = NSDiffableDataSourceSnapshot<Section, UUID>()
            snapshot.appendSections([.main])
            snapshot.appendItems(displayedCards.map(\.id), toSection: .main)
            dataSource.apply(snapshot, animatingDifferences: false)
            KeyboardDiagnostics.shared.record("view.render", fields: [
                "surface": "cards",
                "count": String(displayedCards.count),
            ])
            return
        }

        collectionView.isHidden = true
        stateView.isHidden = false
        if let error = lastError {
            stateView.configure(
                symbol: "exclamationmark.triangle",
                title: model.localization.string("同步失败"),
                message: error,
                actionTitle: model.localization.string("重试")
            ) { [weak self] in self?.refresh() }
        } else {
            stateView.configure(
                symbol: emptyFilterSymbol,
                title: emptyFilterTitle,
                message: model.localization.string("复制文本或图片后回到这里即可发送"),
                actionTitle: nil,
                action: nil
            )
        }
    }

    private func renderSyncButton() {
        let presentation = model.syncPresentation
        if presentation.isSyncing {
            refreshButton.isHidden = true
            refreshSpinner.isHidden = false
            refreshSpinner.startAnimating()
            return
        }
        refreshSpinner.stopAnimating()
        refreshButton.isHidden = model.topBarPresentation.gate == .needsFullAccess
        let symbol: String
        let color: UIColor
        switch presentation.flash {
        case .success:
            symbol = "checkmark.circle.fill"
            color = .systemGreen
        case .failure:
            symbol = "exclamationmark.circle.fill"
            color = .systemOrange
        case nil:
            symbol = "arrow.clockwise"
            color = .secondaryLabel
        }
        refreshButton.setImage(UIImage(systemName: symbol), for: .normal)
        refreshButton.tintColor = color
    }

    private func renderCardActions() {
        collectionView.isUserInteractionEnabled = model.cardActionPresentation.actingCardID == nil
        var snapshot = dataSource.snapshot()
        let ids = snapshot.itemIdentifiers
        guard !ids.isEmpty else { return }
        snapshot.reconfigureItems(ids)
        dataSource.apply(snapshot, animatingDifferences: false)
    }

    private func rebuildFilterSegments() {
        let titles = ["全部", "文本", "链接", "图片"].map {
            model.localization.string($0)
        }
        filterControl.removeAllSegments()
        for (index, title) in titles.enumerated() {
            filterControl.insertSegment(withTitle: title, at: index, animated: false)
        }
        filterControl.selectedSegmentIndex = filter.rawValue
    }

    private func rebuildServerMenu() {
        let choices = model.serverChoices()
        let actions = choices.servers.map { server in
            UIAction(
                title: server.displayLabel,
                state: server.id == choices.activeId ? .on : .off
            ) { [weak self] _ in
                guard let self else { return }
                self.model.keyFeedback()
                self.model.setActiveServer(server.id)
            }
        }
        serverButton.menu = UIMenu(children: actions)
    }

    private var emptyFilterSymbol: String {
        guard isFiltering else { return "tray" }
        switch filter {
        case .all: return "tray"
        case .text: return "doc.text"
        case .link: return "link"
        case .image: return "photo.on.rectangle"
        }
    }

    private var emptyFilterTitle: String {
        guard isFiltering else { return model.localization.string("暂无剪贴板记录") }
        switch filter {
        case .all: return model.localization.string("暂无剪贴板记录")
        case .text: return model.localization.string("暂无文本记录")
        case .link: return model.localization.string("暂无链接记录")
        case .image: return model.localization.string("暂无图片记录")
        }
    }

    private func configureIconButton(
        _ button: UIButton,
        symbol: String,
        symbolSize: CGFloat = 16,
        width: CGFloat = 34,
        height: CGFloat = 34
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

    @objc private func openFilter() {
        model.keyFeedback()
        isFiltering = true
        standardTopBar.isHidden = true
        filterTopBar.isHidden = false
        renderCards()
    }

    @objc private func closeFilter() {
        model.keyFeedback()
        isFiltering = false
        filter = .all
        filterControl.selectedSegmentIndex = filter.rawValue
        standardTopBar.isHidden = false
        filterTopBar.isHidden = true
        renderCards()
    }

    @objc private func filterChanged() {
        model.keyFeedback()
        filter = Filter(rawValue: filterControl.selectedSegmentIndex) ?? .all
        renderCards()
    }

    @objc private func refresh() {
        model.keyFeedback()
        model.requestSync(.manual)
    }

    @objc private func insertSpace() {
        model.keyFeedback()
        model.insertText(" ")
    }

    @objc private func insertReturn() {
        model.keyFeedback()
        model.insertText("\n")
    }

    @objc private func advanceInputMode() {
        model.keyFeedback()
        model.advanceInputMode()
    }

    private func startDeleting() {
        deleteRepeatTask?.cancel()
        deleteRepeatTask = Task { @MainActor [weak self] in
            guard let self else { return }
            model.keyFeedback()
            model.deleteBackward()
            try? await Task.sleep(for: .seconds(0.45))
            var interval = 0.11
            var count = 0
            while !Task.isCancelled, count < 600 {
                model.keyFeedback(haptic: false)
                model.deleteBackward()
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

extension KeyboardRootView: UICollectionViewDelegate {
    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        guard indexPath.item < displayedCards.count else { return }
        model.activate(displayedCards[indexPath.item])
    }
}

@MainActor
private final class KeyboardStateView: UIView {
    private let iconView = UIImageView()
    private let titleLabel = UILabel()
    private let messageLabel = UILabel()
    private let actionButton = UIButton(type: .system)
    private var action: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        let stack = UIStackView(arrangedSubviews: [iconView, titleLabel, messageLabel, actionButton])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 6
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -16),
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
        iconView.tintColor = .secondaryLabel
        iconView.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 22, weight: .medium)
        titleLabel.font = .preferredFont(forTextStyle: .callout).withWeight(.semibold)
        titleLabel.textColor = .label
        messageLabel.font = .preferredFont(forTextStyle: .footnote)
        messageLabel.textColor = .secondaryLabel
        messageLabel.textAlignment = .center
        messageLabel.numberOfLines = 2
        actionButton.titleLabel?.font = .preferredFont(forTextStyle: .footnote).withWeight(.semibold)
        actionButton.addTarget(self, action: #selector(runAction), for: .touchUpInside)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(
        symbol: String,
        title: String,
        message: String,
        actionTitle: String?,
        action: (() -> Void)?
    ) {
        iconView.image = UIImage(systemName: symbol)
        titleLabel.text = title
        messageLabel.text = message
        actionButton.setTitle(actionTitle, for: .normal)
        actionButton.isHidden = actionTitle == nil
        self.action = action
    }

    @objc private func runAction() { action?() }
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

@MainActor
private final class KeyboardCardCell: UICollectionViewCell {
    static let reuseIdentifier = "KeyboardCardCell"

    private let headerStack = UIStackView()
    private let kindIcon = UIImageView()
    private let kindLabel = UILabel()
    private let timeLabel = UILabel()
    private let activity = UIActivityIndicatorView(style: .medium)
    private let titleLabel = UILabel()
    private let subtitleLabel = UILabel()
    private let imageView = UIImageView()
    private let actedOverlay = UIView()
    private let actedLabel = UILabel()
    private var thumbnailTask: Task<Void, Never>?
    private var representedID: UUID?

    override init(frame: CGRect) {
        super.init(frame: frame)
        contentView.backgroundColor = KeyboardSurface.itemUIColor
        contentView.layer.cornerRadius = 18
        contentView.layer.cornerCurve = .continuous
        contentView.clipsToBounds = true

        headerStack.axis = .horizontal
        headerStack.spacing = 5
        headerStack.alignment = .center
        headerStack.translatesAutoresizingMaskIntoConstraints = false
        kindIcon.contentMode = .scaleAspectFit
        kindIcon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 11, weight: .bold)
        kindIcon.widthAnchor.constraint(equalToConstant: 13).isActive = true
        kindLabel.font = .preferredFont(forTextStyle: .caption1).withWeight(.semibold)
        timeLabel.font = .preferredFont(forTextStyle: .caption2)
        timeLabel.textColor = .tertiaryLabel
        activity.hidesWhenStopped = true
        headerStack.addArrangedSubview(kindIcon)
        headerStack.addArrangedSubview(kindLabel)
        headerStack.addArrangedSubview(timeLabel)
        headerStack.addArrangedSubview(UIView())
        headerStack.addArrangedSubview(activity)

        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.font = .preferredFont(forTextStyle: .callout)
        titleLabel.textColor = .label
        titleLabel.numberOfLines = 5
        titleLabel.textAlignment = .left
        subtitleLabel.translatesAutoresizingMaskIntoConstraints = false
        subtitleLabel.font = .preferredFont(forTextStyle: .caption2)
        subtitleLabel.textColor = .systemBlue
        subtitleLabel.lineBreakMode = .byTruncatingMiddle
        imageView.translatesAutoresizingMaskIntoConstraints = false
        imageView.contentMode = .scaleAspectFill
        imageView.clipsToBounds = true
        imageView.layer.cornerRadius = 10
        imageView.layer.cornerCurve = .continuous
        imageView.tintColor = .secondaryLabel
        imageView.backgroundColor = UIColor.systemOrange.withAlphaComponent(0.12)

        actedOverlay.translatesAutoresizingMaskIntoConstraints = false
        actedOverlay.backgroundColor = KeyboardSurface.itemUIColor.withAlphaComponent(0.94)
        actedOverlay.isHidden = true
        actedLabel.translatesAutoresizingMaskIntoConstraints = false
        actedLabel.font = .preferredFont(forTextStyle: .subheadline).withWeight(.semibold)
        actedLabel.textColor = .systemGreen
        actedLabel.textAlignment = .center
        actedOverlay.addSubview(actedLabel)

        [headerStack, titleLabel, subtitleLabel, imageView, actedOverlay].forEach(contentView.addSubview)
        NSLayoutConstraint.activate([
            headerStack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 12),
            headerStack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -12),
            headerStack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 12),
            titleLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 12),
            titleLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -12),
            titleLabel.topAnchor.constraint(equalTo: headerStack.bottomAnchor, constant: 8),
            titleLabel.bottomAnchor.constraint(lessThanOrEqualTo: contentView.bottomAnchor, constant: -12),
            subtitleLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 12),
            subtitleLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -12),
            subtitleLabel.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -12),
            imageView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 12),
            imageView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -12),
            imageView.topAnchor.constraint(equalTo: headerStack.bottomAnchor, constant: 8),
            imageView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -12),
            actedOverlay.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            actedOverlay.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            actedOverlay.topAnchor.constraint(equalTo: contentView.topAnchor),
            actedOverlay.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
            actedLabel.centerXAnchor.constraint(equalTo: actedOverlay.centerXAnchor),
            actedLabel.centerYAnchor.constraint(equalTo: actedOverlay.centerYAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func prepareForReuse() {
        super.prepareForReuse()
        thumbnailTask?.cancel()
        thumbnailTask = nil
        representedID = nil
        imageView.image = nil
        activity.stopAnimating()
        actedOverlay.isHidden = true
    }

    func configure(
        model: KeyboardModel,
        card: KeyboardModel.Card,
        isActing: Bool,
        didAct: Bool
    ) {
        representedID = card.id
        timeLabel.text = card.time
        titleLabel.text = card.title
        subtitleLabel.text = card.subtitle.map { "⌁ \($0)" }
        activity.setAnimating(isActing)
        actedOverlay.isHidden = !didAct
        actedLabel.text = "✓ " + model.localization.string(card.kind == .image ? "已复制" : "已插入")

        let symbol: String
        let kind: String
        let tint: UIColor
        switch card.kind {
        case .text:
            symbol = "text.alignleft"
            kind = model.localization.string("文本")
            tint = .secondaryLabel
        case .link:
            symbol = "link"
            kind = model.localization.string("链接")
            tint = .systemBlue
        case .image:
            symbol = "photo"
            kind = model.localization.string("图片")
            tint = .systemOrange
        }
        kindIcon.image = UIImage(systemName: symbol)
        kindIcon.tintColor = tint
        kindLabel.text = kind
        kindLabel.textColor = tint
        subtitleLabel.isHidden = card.kind != .link
        imageView.isHidden = card.kind != .image
        titleLabel.isHidden = card.kind == .image

        thumbnailTask?.cancel()
        thumbnailTask = nil
        guard card.kind == .image else { return }
        imageView.image = UIImage(systemName: "photo.badge.arrow.down")
        thumbnailTask = Task { @MainActor [weak self, weak model] in
            guard let model else { return }
            let image = await model.thumbnail(for: card)
            guard !Task.isCancelled, self?.representedID == card.id else { return }
            self?.imageView.image = image ?? UIImage(systemName: "photo")
        }
    }
}

private extension UIFont {
    func withWeight(_ weight: UIFont.Weight) -> UIFont {
        let descriptor = fontDescriptor.addingAttributes([
            .traits: [UIFontDescriptor.TraitKey.weight: weight],
        ])
        return UIFont(descriptor: descriptor, size: pointSize)
    }
}

private extension UIActivityIndicatorView {
    func setAnimating(_ animating: Bool) {
        animating ? startAnimating() : stopAnimating()
    }
}
