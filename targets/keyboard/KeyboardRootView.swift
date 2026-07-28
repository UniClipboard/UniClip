import Combine
import UIKit

enum KeyboardSurface {
    static let trayUIColor = UIColor { trait in
        trait.userInterfaceStyle == .dark ? .systemGray6 : .systemGray5
    }
    static let itemUIColor = UIColor { trait in
        trait.userInterfaceStyle == .dark ? UIColor(white: 0.34, alpha: 1) : .white
    }
}

@MainActor
final class KeyboardRootView: UIView {
    var onPreferredHeightChange: ((CGFloat) -> Void)?

    private let viewStore: any KeyboardViewStore
    private var viewState: KeyboardViewState
    private var cancellables = Set<AnyCancellable>()
    private let rootStack = UIStackView()
    private let topBarView = KeyboardTopBarView()
    private let keyRowView = KeyboardKeyRowView()
    private lazy var cardListView = KeyboardCardListView(loadThumbnail: { [weak self] cardID, maxPixel in
        guard let self else { return nil }
        return await viewStore.thumbnail(for: cardID, maxPixel: maxPixel)
    })

    init(viewStore: any KeyboardViewStore) {
        self.viewStore = viewStore
        viewState = viewStore.state
        super.init(frame: .zero)
        isOpaque = false
        backgroundColor = .clear
        buildHierarchy()
        routeRegionActions()
        renderLayout()
        renderTopBar()
        cardListView.render(content: viewState.content, strings: viewState.strings)
        keyRowView.render(layout: viewState.layout, strings: viewState.strings)
        bindViewStore()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var intrinsicContentSize: CGSize {
        CGSize(width: UIView.noIntrinsicMetric, height: preferredHeight)
    }

    var preferredHeight: CGFloat {
        KeyboardLayoutMetrics.targetHeight(
            hasFullAccess: viewState.layout.hasFullAccess,
            needsInputModeSwitchKey: viewState.layout.needsInputModeSwitchKey
        )
    }

    private func buildHierarchy() {
        translatesAutoresizingMaskIntoConstraints = false
        rootStack.axis = .vertical
        rootStack.spacing = 0
        rootStack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(rootStack)
        rootStack.addArrangedSubview(topBarView)
        rootStack.addArrangedSubview(cardListView)
        rootStack.addArrangedSubview(keyRowView)
        NSLayoutConstraint.activate([
            rootStack.leadingAnchor.constraint(equalTo: leadingAnchor),
            rootStack.trailingAnchor.constraint(equalTo: trailingAnchor),
            rootStack.topAnchor.constraint(equalTo: topAnchor),
            rootStack.bottomAnchor.constraint(equalTo: bottomAnchor),
            topBarView.heightAnchor.constraint(
                equalToConstant: KeyboardLayoutMetrics.topBarHeight + KeyboardLayoutMetrics.topBarVPad * 2
            ),
            cardListView.heightAnchor.constraint(
                equalToConstant: KeyboardLayoutMetrics.cardHeight + KeyboardLayoutMetrics.cardRowVPad * 2
            ),
        ])
    }

    private func routeRegionActions() {
        topBarView.onRefresh = { [weak self] in self?.viewStore.send(.refresh) }
        topBarView.onSelectServer = { [weak self] id in self?.viewStore.send(.selectServer(id)) }
        topBarView.onFeedback = { [weak self] in self?.viewStore.send(.feedback) }
        topBarView.onFilterPresentationChange = { [weak self] presentation in
            self?.cardListView.applyFilterPresentation(presentation)
        }
        cardListView.onAction = { [weak self] action in self?.viewStore.send(action) }
        cardListView.onFilterPresentationChange = { [weak self] _ in self?.renderTopBar() }
        keyRowView.onInsertSpace = { [weak self] in self?.viewStore.send(.insertSpace) }
        keyRowView.onInsertReturn = { [weak self] in self?.viewStore.send(.insertReturn) }
        keyRowView.onDeleteBackward = { [weak self] isRepeating in
            self?.viewStore.send(.deleteBackward(isRepeating: isRepeating))
        }
        keyRowView.onAdvanceInputMode = { [weak self] in self?.viewStore.send(.advanceInputMode) }
    }

    private func bindViewStore() {
        viewStore.statePublisher
            .sink { [weak self] state in self?.render(state: state) }
            .store(in: &cancellables)
    }

    private func render(state next: KeyboardViewState) {
        let previous = viewState
        let layoutChanged = previous.layout != next.layout
        let topBarChanged = previous.topBar != next.topBar
            || previous.strings != next.strings
            || previous.sync != next.sync
        let cardListChanged = previous.content != next.content || previous.strings != next.strings
        let keyRowChanged = layoutChanged || previous.strings != next.strings
        viewState = next
        if layoutChanged { renderLayout() }
        if topBarChanged { renderTopBar() }
        if cardListChanged { cardListView.render(content: viewState.content, strings: viewState.strings) }
        if keyRowChanged { keyRowView.render(layout: viewState.layout, strings: viewState.strings) }
    }

    private func renderTopBar() {
        topBarView.render(
            topBar: viewState.topBar,
            strings: viewState.strings,
            sync: viewState.sync,
            filterPresentation: cardListView.filterPresentation
        )
    }

    private func renderLayout() {
        invalidateIntrinsicContentSize()
        onPreferredHeightChange?(preferredHeight)
    }
}

extension UIFont {
    func withWeight(_ weight: UIFont.Weight) -> UIFont {
        let descriptor = fontDescriptor.addingAttributes([
            .traits: [UIFontDescriptor.TraitKey.weight: weight],
        ])
        return UIFont(descriptor: descriptor, size: pointSize)
    }
}
