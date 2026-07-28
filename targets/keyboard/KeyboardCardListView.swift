import UIKit

@MainActor
final class KeyboardCardListView: UIView {
    var onAction: ((KeyboardViewAction) -> Void)?
    var onFilterPresentationChange: ((KeyboardFilterPresentation) -> Void)?

    private enum Section: Hashable { case main }

    private struct CardListInput: Equatable {
        let content: KeyboardViewState.Content
    }

    private let loadThumbnail: (UUID, CGFloat) async -> KeyboardViewThumbnail?
    private let stateView = KeyboardStateView()
    private(set) var filterPresentation = KeyboardFilterPresentation(isFiltering: false, filter: .all)
    private var matchingCards: [KeyboardViewCard] = []
    private var displayedCards: [KeyboardViewCard] = []
    private var visibleCardLimit = 0
    private var cardsByID: [UUID: KeyboardViewCard] = [:]
    private var previousCardListInput: CardListInput?
    private var previousCardActionState = KeyboardCardActionState<UUID>(actingID: nil, actedID: nil)
    private var previousStrings: KeyboardViewState.Strings?
    private var nextCardUpdateID = 0
    private var activeCardUpdate: (id: Int, reason: KeyboardCardUpdateReason)?

    private lazy var collectionView: UICollectionView = {
        let layout = UICollectionViewFlowLayout()
        layout.scrollDirection = .horizontal
        layout.itemSize = CGSize(width: KeyboardLayoutMetrics.cardWidth, height: KeyboardLayoutMetrics.cardHeight)
        layout.minimumLineSpacing = KeyboardLayoutMetrics.cardSpacing
        layout.minimumInteritemSpacing = KeyboardLayoutMetrics.cardSpacing
        layout.sectionInset = UIEdgeInsets(
            top: KeyboardLayoutMetrics.cardRowVPad,
            left: KeyboardLayoutMetrics.hMargin,
            bottom: KeyboardLayoutMetrics.cardRowVPad,
            right: KeyboardLayoutMetrics.hMargin
        )
        let view = UICollectionView(frame: .zero, collectionViewLayout: layout)
        view.translatesAutoresizingMaskIntoConstraints = false
        view.backgroundColor = .clear
        view.showsHorizontalScrollIndicator = false
        view.alwaysBounceHorizontal = true
        view.decelerationRate = .fast
        if #available(iOS 26.0, *) {
            view.topEdgeEffect.isHidden = true
            view.bottomEdgeEffect.isHidden = true
            view.leftEdgeEffect.isHidden = true
            view.rightEdgeEffect.isHidden = true
        }
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
        KeyboardDiagnostics.shared.record("view.card.configure", fields: [
            "updateID": self.activeCardUpdate.map { String($0.id) } ?? "none",
            "reason": self.activeCardUpdate?.reason.rawValue ?? "unattributed",
            "cardID": id.uuidString,
            "index": String(indexPath.item),
        ])
        cell.configure(card: card, loadThumbnail: self.loadThumbnail)
        return cell
    }

    init(loadThumbnail: @escaping (UUID, CGFloat) async -> KeyboardViewThumbnail?) {
        self.loadThumbnail = loadThumbnail
        super.init(frame: .zero)
        backgroundColor = .clear
        buildHierarchy()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func render(content: KeyboardViewState.Content, strings: KeyboardViewState.Strings) {
        let input = CardListInput(content: content)
        let stringsChanged = previousStrings != strings
        let contentChanged = hasCardContentChange(from: previousCardListInput?.content, to: content)
        previousStrings = strings
        if contentChanged || stringsChanged {
            renderCards(content: content, strings: strings, requestedReason: stringsChanged ? .localization : nil)
        }
        if hasCardActionChange(from: previousCardListInput?.content.cards ?? [], to: content.cards) {
            renderCardActions(content: content)
        }
        previousCardListInput = input
    }

    func applyFilterPresentation(_ presentation: KeyboardFilterPresentation) {
        guard filterPresentation != presentation else { return }
        filterPresentation = presentation
        onFilterPresentationChange?(presentation)
        guard let content = previousCardListInput?.content, let strings = previousStrings else { return }
        renderCards(content: content, strings: strings, requestedReason: .filter)
    }

    private func buildHierarchy() {
        addSubview(collectionView)
        stateView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stateView)
        NSLayoutConstraint.activate([
            collectionView.leadingAnchor.constraint(equalTo: leadingAnchor),
            collectionView.trailingAnchor.constraint(equalTo: trailingAnchor),
            collectionView.topAnchor.constraint(equalTo: topAnchor),
            collectionView.bottomAnchor.constraint(equalTo: bottomAnchor),
            stateView.leadingAnchor.constraint(equalTo: leadingAnchor, constant: KeyboardLayoutMetrics.hMargin),
            stateView.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -KeyboardLayoutMetrics.hMargin),
            stateView.topAnchor.constraint(equalTo: topAnchor),
            stateView.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    private func hasCardContentChange(
        from previous: KeyboardViewState.Content?,
        to next: KeyboardViewState.Content
    ) -> Bool {
        guard let previous,
              previous.mode == next.mode,
              previous.message == next.message,
              previous.cards.count == next.cards.count else { return true }
        return zip(previous.cards, next.cards).contains { previous, next in
            previous.id != next.id
                || previous.kind != next.kind
                || previous.kindTitle != next.kindTitle
                || previous.title != next.title
                || previous.subtitle != next.subtitle
                || previous.time != next.time
                || previous.sizeText != next.sizeText
                || previous.actionConfirmation != next.actionConfirmation
                || previous.thumbnailVersion != next.thumbnailVersion
        }
    }

    private func hasCardActionChange(from previous: [KeyboardViewCard], to next: [KeyboardViewCard]) -> Bool {
        guard previous.count == next.count else { return false }
        return zip(previous, next).contains {
            $0.isActing != $1.isActing || $0.didAct != $1.didAct
        }
    }

    private func renderCards(
        content: KeyboardViewState.Content,
        strings: KeyboardViewState.Strings,
        requestedReason: KeyboardCardUpdateReason?
    ) {
        let input = CardListInput(content: content)
        let reason = requestedReason ?? cardUpdateReason(from: previousCardListInput, to: input)
        matchingCards = filterPresentation.isFiltering
            ? content.cards.filter(filterPresentation.filter.matches)
            : content.cards

        if content.mode == .needsFullAccess, let message = content.message {
            recordCardUpdatePlan(.none(reason: reason))
            collectionView.isHidden = true
            stateView.isHidden = false
            stateView.configure(
                symbol: "lock.shield",
                title: message.title,
                message: message.detail,
                actionTitle: message.actionTitle
            ) { [weak self] in self?.onAction?(.openSettings) }
            return
        }

        if content.mode == .cards {
            let resetsVisibleBatch = dataSource.snapshot().itemIdentifiers.isEmpty
                || requestedReason == .filter
                || visibleCardLimit == 0
            if resetsVisibleBatch {
                visibleCardLimit = KeyboardCardBatching.initialVisibleCount(totalCount: matchingCards.count)
            } else {
                let minimumInitialBatch = KeyboardCardBatching.initialVisibleCount(totalCount: matchingCards.count)
                visibleCardLimit = min(max(visibleCardLimit, minimumInitialBatch), matchingCards.count)
            }
            displayedCards = Array(matchingCards.prefix(visibleCardLimit))
            stateView.isHidden = true
            collectionView.isHidden = false
            cardsByID = Dictionary(uniqueKeysWithValues: displayedCards.map { ($0.id, $0) })
            let plan = KeyboardCardUpdatePlan.list(
                previousIDs: dataSource.snapshot().itemIdentifiers,
                nextIDs: displayedCards.map(\.id),
                reason: reason
            )
            var snapshot = NSDiffableDataSourceSnapshot<Section, UUID>()
            snapshot.appendSections([.main])
            snapshot.appendItems(displayedCards.map(\.id), toSection: .main)
            let updateID = beginCardUpdate(plan)
            dataSource.apply(snapshot, animatingDifferences: false) { [weak self] in
                self?.endCardUpdate(updateID)
            }
            return
        }

        collectionView.isHidden = true
        stateView.isHidden = false
        matchingCards = []
        displayedCards = []
        visibleCardLimit = 0
        recordCardUpdatePlan(.none(reason: reason))
        if content.mode == .error, let message = content.message {
            stateView.configure(
                symbol: message.symbol,
                title: message.title,
                message: message.detail,
                actionTitle: message.actionTitle
            ) { [weak self] in self?.onAction?(.refresh) }
        } else {
            stateView.configure(
                symbol: emptyFilterSymbol,
                title: emptyFilterTitle(strings.emptyTitles),
                message: strings.emptyMessage,
                actionTitle: nil,
                action: nil
            )
        }
    }

    private func renderCardActions(content: KeyboardViewState.Content) {
        let current = KeyboardCardActionState(
            actingID: content.cards.first(where: \.isActing)?.id,
            actedID: content.cards.first(where: \.didAct)?.id
        )
        let plan = KeyboardCardUpdatePlan.cardAction(
            displayedIDs: dataSource.snapshot().itemIdentifiers,
            previous: previousCardActionState,
            current: current
        )
        previousCardActionState = current
        collectionView.isUserInteractionEnabled = current.actingID == nil
        var snapshot = dataSource.snapshot()
        guard !plan.reconfiguredIDs.isEmpty else {
            recordCardUpdatePlan(plan)
            return
        }
        snapshot.reconfigureItems(plan.reconfiguredIDs)
        let updateID = beginCardUpdate(plan)
        dataSource.apply(snapshot, animatingDifferences: false) { [weak self] in
            self?.endCardUpdate(updateID)
        }
    }

    private func cardUpdateReason(
        from previous: CardListInput?,
        to current: CardListInput
    ) -> KeyboardCardUpdateReason {
        guard let previous else { return .initial }
        if previous.content.cards.map(\.id) != current.content.cards.map(\.id) { return .cards }
        if previous.content.mode != current.content.mode {
            return current.content.mode == .needsFullAccess ? .gate : .error
        }
        if previous.content.message != current.content.message { return .error }
        return .unchanged
    }

    private var emptyFilterSymbol: String {
        guard filterPresentation.isFiltering else { return "tray" }
        switch filterPresentation.filter {
        case .all: return "tray"
        case .text: return "doc.text"
        case .link: return "link"
        case .image: return "photo.on.rectangle"
        }
    }

    private func emptyFilterTitle(_ titles: KeyboardViewState.Strings.EmptyTitles) -> String {
        guard filterPresentation.isFiltering else { return titles.all }
        switch filterPresentation.filter {
        case .all: return titles.all
        case .text: return titles.text
        case .link: return titles.link
        case .image: return titles.image
        }
    }

    @discardableResult
    private func recordCardUpdatePlan(_ plan: KeyboardCardUpdatePlan<UUID>) -> Int {
        nextCardUpdateID += 1
        let updateID = nextCardUpdateID
        KeyboardDiagnostics.shared.record("view.card.update.plan", fields: [
            "updateID": String(updateID),
            "reason": plan.reason.rawValue,
            "affectedIDs": diagnosticIDs(plan.affectedIDs),
            "insertedIDs": diagnosticIDs(plan.insertedIDs),
            "removedIDs": diagnosticIDs(plan.removedIDs),
            "movedIDs": diagnosticIDs(plan.movedIDs),
            "reconfiguredIDs": diagnosticIDs(plan.reconfiguredIDs),
        ])
        return updateID
    }

    private func beginCardUpdate(_ plan: KeyboardCardUpdatePlan<UUID>) -> Int {
        let updateID = recordCardUpdatePlan(plan)
        activeCardUpdate = (updateID, plan.reason)
        return updateID
    }

    private func endCardUpdate(_ updateID: Int) {
        guard activeCardUpdate?.id == updateID else { return }
        activeCardUpdate = nil
    }

    private func diagnosticIDs(_ ids: [UUID]) -> String {
        ids.map(\.uuidString).joined(separator: ",")
    }
}

extension KeyboardCardListView: UICollectionViewDelegate {
    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        guard indexPath.item < displayedCards.count else { return }
        onAction?(.activateCard(displayedCards[indexPath.item].id))
    }

    func collectionView(_ collectionView: UICollectionView, willDisplay cell: UICollectionViewCell, forItemAt indexPath: IndexPath) {
        let nextVisibleCount = KeyboardCardBatching.nextVisibleCount(
            totalCount: matchingCards.count,
            currentVisibleCount: displayedCards.count,
            displayedIndex: indexPath.item
        )
        guard nextVisibleCount > displayedCards.count,
              let content = previousCardListInput?.content,
              let strings = previousStrings else { return }
        visibleCardLimit = nextVisibleCount
        renderCards(content: content, strings: strings, requestedReason: .cards)
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
