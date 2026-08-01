import Combine
import Foundation
internal import UcEngineCore

extension KeyboardModel: KeyboardViewStore {
    var state: KeyboardViewState {
        let displayedCards = cards.map(viewCard(from:))
        let content: KeyboardViewState.Content
        if gate == .needsFullAccess {
            content = .init(
                mode: .needsFullAccess,
                cards: [],
                message: .init(
                    symbol: "lock.shield",
                    title: localization.string("需要「完全访问权限」"),
                    detail: localization.string(
                        "在 设置 › 通用 › 键盘 › UniClip 中开启「允许完全访问」,即可在打开键盘时自动同步剪贴板。"
                    ),
                    actionTitle: KeyboardSettingsURL.destination == nil
                        ? nil
                        : localization.string("前往设置 ›")
                )
            )
        } else if !displayedCards.isEmpty {
            content = .init(mode: .cards, cards: displayedCards, message: nil)
        } else if let lastError {
            content = .init(
                mode: .error,
                cards: [],
                message: .init(
                    symbol: "exclamationmark.triangle",
                    title: localization.string("同步失败"),
                    detail: lastError,
                    actionTitle: localization.string("重试")
                )
            )
        } else {
            content = .init(mode: .empty, cards: [], message: nil)
        }

        return KeyboardViewState(
            layout: .init(
                hasFullAccess: hasFullAccess,
                needsInputModeSwitchKey: needsInputModeSwitchKey,
                returnKeyTitle: returnKeyTitle
            ),
            topBar: .init(
                title: "UniClip",
                showsSearch: gate != .needsFullAccess && !cards.isEmpty,
                showsRefresh: gate != .needsFullAccess
            ),
            content: content,
            strings: .init(
                searchLabel: localization.string("筛选"),
                refreshLabel: localization.string("刷新"),
                closeFilterLabel: localization.string("关闭筛选"),
                globeLabel: localization.string("切换键盘"),
                deleteLabel: localization.string("删除"),
                returnLabel: localization.string("回车"),
                spaceTitle: localization.string("空格"),
                filterTitles: ["全部", "文本", "链接", "图片"].map {
                    localization.string($0)
                },
                emptyTitles: .init(
                    all: localization.string("暂无剪贴板记录"),
                    text: localization.string("暂无文本记录"),
                    link: localization.string("暂无链接记录"),
                    image: localization.string("暂无图片记录")
                ),
                emptyMessage: localization.string("复制文本或图片后回到这里即可发送")
            ),
            sync: .init(
                isSyncing: isSyncing,
                flash: syncFlash.map {
                    $0 == .success ? .success : .failure
                }
            )
        )
    }

    var statePublisher: AnyPublisher<KeyboardViewState, Never> {
        let updates: [AnyPublisher<Void, Never>] = [
            $hasFullAccess.map { _ in () }.eraseToAnyPublisher(),
            $needsInputModeSwitchKey.map { _ in () }.eraseToAnyPublisher(),
            $localization.map { _ in () }.eraseToAnyPublisher(),
            $returnKeyTitle.map { _ in () }.eraseToAnyPublisher(),
            $gate.map { _ in () }.eraseToAnyPublisher(),
            $lastError.map { _ in () }.eraseToAnyPublisher(),
            $cards.map { _ in () }.eraseToAnyPublisher(),
            $actingCardID.map { _ in () }.eraseToAnyPublisher(),
            $actedCardID.map { _ in () }.eraseToAnyPublisher(),
            $isSyncing.map { _ in () }.eraseToAnyPublisher(),
            $syncFlash.map { _ in () }.eraseToAnyPublisher(),
        ]
        return Publishers.MergeMany(updates)
            .receive(on: RunLoop.main)
            .map { [weak self] _ in self?.state }
            .compactMap { $0 }
            .eraseToAnyPublisher()
    }

    func send(_ action: KeyboardViewAction) {
        switch action {
        case .refresh:
            keyFeedback()
            requestSync(.manual)
        case .activateCard(let id):
            guard let card = cards.first(where: { $0.id == id }) else { return }
            activate(card)
        case .insertSpace:
            keyFeedback()
            insertText(" ")
        case .insertReturn:
            keyFeedback()
            insertText("\n")
        case .deleteBackward(let isRepeating):
            keyFeedback(haptic: !isRepeating)
            deleteBackward()
        case .advanceInputMode:
            keyFeedback()
            advanceInputMode()
        case .openSettings:
            keyFeedback()
            openSettings()
        case .feedback:
            keyFeedback()
        }
    }

    func thumbnail(for cardID: UUID, maxPixel: CGFloat) async -> KeyboardViewThumbnail? {
        guard let card = cards.first(where: { $0.id == cardID }) else { return nil }
        return await thumbnail(for: card, maxPixel: maxPixel)
    }

    private func viewCard(from card: Card) -> KeyboardViewCard {
        let kind: KeyboardViewCard.Kind
        let kindTitle: String
        switch card.kind {
        case .text:
            kind = .text
            kindTitle = localization.string("文本")
        case .link:
            kind = .link
            kindTitle = localization.string("链接")
        case .image:
            kind = .image
            kindTitle = localization.string("图片")
        }
        return KeyboardViewCard(
            id: card.id,
            kind: kind,
            kindTitle: kindTitle,
            title: card.title,
            subtitle: card.subtitle,
            time: card.time,
            sizeText: card.sizeText,
            actionConfirmation: localization.string(card.kind == .image ? "已复制" : "已插入"),
            isActing: actingCardID == card.id,
            didAct: actedCardID == card.id,
            thumbnailVersion: card.entry.hash ?? card.entry.dataName
        )
    }
}
