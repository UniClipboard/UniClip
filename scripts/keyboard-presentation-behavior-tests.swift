import Foundation
import Combine

private enum BehaviorTestFailure: Error, CustomStringConvertible {
    case mismatch(String)

    var description: String {
        switch self {
        case .mismatch(let message): message
        }
    }
}

@main
private enum KeyboardPresentationBehaviorTests {
    @MainActor
    static func main() {
        do {
            let requireTargetBehavior = CommandLine.arguments.contains("--require-target-behavior")
            try run(requireTargetBehavior: requireTargetBehavior)
            print("PASS: keyboard presentation behavior checks")
        } catch {
            fputs("FAIL: \(error)\n", stderr)
            exit(1)
        }
    }

    @MainActor
    private static func run(requireTargetBehavior _: Bool) throws {
        try verifyViewStoreBoundary()
        try verifyLayoutMetrics()

        try expectEqual(
            KeyboardContentMode.resolve(
                requiresFullAccess: true,
                displayedCardCount: 3,
                lastError: "offline"
            ),
            .needsFullAccess,
            "Full Access must take precedence over cached cards and errors"
        )
        try expectEqual(
            KeyboardContentMode.resolve(
                requiresFullAccess: false,
                displayedCardCount: 3,
                lastError: "offline"
            ),
            .cards,
            "non-empty cards must stay visible when an inline error is present"
        )
        try expectEqual(
            KeyboardContentMode.resolve(
                requiresFullAccess: false,
                displayedCardCount: 0,
                lastError: "offline"
            ),
            .error,
            "an error must replace the empty state only when there are no cards"
        )
        try expectEqual(
            KeyboardContentMode.resolve(
                requiresFullAccess: false,
                displayedCardCount: 0,
                lastError: nil
            ),
            .empty,
            "an empty card list without an error must show the empty state"
        )

        let original = ["card-a", "card-b", "card-c"]
        let inserted = KeyboardCardUpdatePlan.list(
            previousIDs: original,
            nextIDs: ["card-new"] + original,
            reason: .cards
        )
        try expectEqual(inserted.insertedIDs, ["card-new"], "a new head card must be one insert")
        try expect(inserted.removedIDs.isEmpty, "a head insert must not remove existing cards")
        try expect(inserted.movedIDs.isEmpty, "a head insert must not report every shifted card as moved")
        try expect(inserted.reconfiguredIDs.isEmpty, "a head insert must not reconfigure existing cards")

        let reordered = KeyboardCardUpdatePlan.list(
            previousIDs: original,
            nextIDs: ["card-b", "card-a", "card-c"],
            reason: .cards
        )
        try expect(reordered.insertedIDs.isEmpty, "a reorder must not insert cards")
        try expect(reordered.removedIDs.isEmpty, "a reorder must not remove cards")
        try expectEqual(reordered.movedIDs.count, 1, "a two-card reorder must be represented by one move")

        let errorOnly = KeyboardCardUpdatePlan.list(
            previousIDs: original,
            nextIDs: original,
            reason: .error
        )
        try expect(!errorOnly.hasOperations, "a non-empty-list error change must create no card operation")

        let syncOnly = KeyboardCardUpdatePlan<String>.none(reason: .syncButton)
        try expect(!syncOnly.hasOperations, "a sync-button change must create no card operation")

        try expectEqual(
            KeyboardCardBatching.initialVisibleCount(totalCount: 47),
            20,
            "the initial card batch must not exceed 20 cards"
        )
        try expectEqual(
            KeyboardCardBatching.initialVisibleCount(totalCount: 7),
            7,
            "a short card list must display all available cards"
        )
        try expectEqual(
            KeyboardCardBatching.nextVisibleCount(
                totalCount: 47,
                currentVisibleCount: 20,
                displayedIndex: 18
            ),
            20,
            "displaying before the visible batch end must not append cards"
        )
        try expectEqual(
            KeyboardCardBatching.nextVisibleCount(
                totalCount: 47,
                currentVisibleCount: 20,
                displayedIndex: 19
            ),
            40,
            "displaying the visible batch end must append exactly one 20-card batch"
        )
        try expectEqual(
            KeyboardCardBatching.nextVisibleCount(
                totalCount: 47,
                currentVisibleCount: 40,
                displayedIndex: 39
            ),
            47,
            "the final batch must contain only the remaining cards"
        )
        try expectEqual(
            KeyboardCardBatching.nextVisibleCount(
                totalCount: 47,
                currentVisibleCount: 47,
                displayedIndex: 46
            ),
            47,
            "the final card must not append beyond the available list"
        )

        let imageCardID = UUID()
        let originalThumbnail = KeyboardThumbnailRequest(cardID: imageCardID, version: "v1")
        try expect(
            !originalThumbnail.requiresReload(from: originalThumbnail),
            "an unchanged image card must retain its existing thumbnail"
        )
        try expect(
            KeyboardThumbnailRequest(cardID: imageCardID, version: "v2").requiresReload(from: originalThumbnail),
            "a changed thumbnail version must reload the image"
        )
        try expect(
            KeyboardThumbnailRequest(cardID: UUID(), version: "v1").requiresReload(from: originalThumbnail),
            "a different card must load its own thumbnail"
        )

        let startedAction = KeyboardCardUpdatePlan.cardAction(
            displayedIDs: original,
            previous: KeyboardCardActionState<String>(actingID: nil, actedID: nil),
            current: KeyboardCardActionState<String>(actingID: "card-b", actedID: nil)
        )
        try expectEqual(
            startedAction.affectedIDs,
            ["card-b"],
            "starting one card action must affect only its stable ID"
        )

        let movedAction = KeyboardCardUpdatePlan.cardAction(
            displayedIDs: original,
            previous: KeyboardCardActionState(actingID: "card-a", actedID: nil),
            current: KeyboardCardActionState(actingID: "card-b", actedID: nil)
        )
        try expectEqual(
            movedAction.affectedIDs,
            ["card-a", "card-b"],
            "moving action state may affect only the previous and current cards"
        )

        try expectEqual(
            startedAction.reconfiguredIDs,
            startedAction.affectedIDs,
            "one card action must not reconfigure unrelated cards"
        )
        try expectEqual(
            movedAction.reconfiguredIDs,
            movedAction.affectedIDs,
            "moving card action state must reconfigure at most the previous and current cards"
        )
    }

    private static func verifyLayoutMetrics() throws {
        try expectEqual(
            KeyboardLayoutMetrics.targetHeight(
                hasFullAccess: true,
                needsInputModeSwitchKey: true
            ),
            KeyboardLayoutMetrics.contentHeight + KeyboardLayoutMetrics.stripBandHeight,
            "a full keyboard with the input-mode key must include both content and strip"
        )
        try expectEqual(
            KeyboardLayoutMetrics.targetHeight(
                hasFullAccess: false,
                needsInputModeSwitchKey: false
            ),
            KeyboardLayoutMetrics.restrictedContentHeight,
            "a restricted single-keyboard layout must omit both the key row and strip"
        )
    }

    @MainActor
    private static func verifyViewStoreBoundary() throws {
        let permission = makeState(content: .needsFullAccess)
        let empty = makeState(content: .empty)
        let error = makeState(content: .error)
        let cards = makeState(content: .cards)
        let store = FakeKeyboardViewStore(state: permission)
        var receivedStates: [KeyboardViewState] = []
        let observation = store.statePublisher.sink { receivedStates.append($0) }

        try expectEqual(store.state.content.mode, .needsFullAccess, "a fake store must drive the permission screen")
        store.publish(empty)
        try expectEqual(store.state.content.mode, .empty, "a fake store must drive the empty screen")
        store.publish(error)
        try expectEqual(store.state.content.mode, .error, "a fake store must drive the error screen")
        store.publish(cards)
        try expectEqual(store.state.content.mode, .cards, "a fake store must drive the card screen")

        store.send(.refresh)
        store.send(.selectServer("server-2"))
        store.send(.activateCard(cards.content.cards[0].id))
        try expectEqual(
            store.actions,
            [.refresh, .selectServer("server-2"), .activateCard(cards.content.cards[0].id)],
            "the display boundary must preserve user actions without exposing model types"
        )
        try expect(receivedStates.count == 4, "a fake store must publish each replacement display state")
        _ = observation
    }

    @MainActor
    private static func makeState(content mode: KeyboardViewState.Content.Mode) -> KeyboardViewState {
        let card = KeyboardViewCard(
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
            kind: .text,
            kindTitle: "Text",
            title: "Example",
            subtitle: nil,
            time: "now",
            sizeText: "7 chars",
            actionConfirmation: "Inserted",
            isActing: false,
            didAct: false,
            thumbnailVersion: nil
        )
        return KeyboardViewState(
            layout: .init(hasFullAccess: mode != .needsFullAccess, needsInputModeSwitchKey: true, returnKeyTitle: nil),
            topBar: .init(title: "UniClip", showsSearch: mode == .cards, showsRefresh: mode != .needsFullAccess, isServerEnabled: true, servers: [
                .init(id: "server-1", title: "Home", isActive: true),
                .init(id: "server-2", title: "Work", isActive: false),
            ]),
            content: .init(
                mode: mode,
                cards: mode == .cards ? [card] : [],
                message: mode == .needsFullAccess
                    ? .init(symbol: "lock.shield", title: "Full Access", detail: "Enable access", actionTitle: "Settings")
                    : mode == .error
                        ? .init(symbol: "exclamationmark.triangle", title: "Sync failed", detail: "Offline", actionTitle: "Retry")
                        : nil
            ),
            strings: .init(
                searchLabel: "Filter",
                refreshLabel: "Refresh",
                closeFilterLabel: "Close filter",
                serverLabel: "Switch server",
                globeLabel: "Switch keyboard",
                deleteLabel: "Delete",
                returnLabel: "Return",
                spaceTitle: "Space",
                filterTitles: ["All", "Text", "Links", "Images"],
                emptyTitles: .init(all: "No clips", text: "No text", link: "No links", image: "No images"),
                emptyMessage: "Copy something to get started"
            ),
            sync: .init(isSyncing: false, flash: nil)
        )
    }

    private static func expect(_ condition: @autoclosure () -> Bool, _ message: String) throws {
        guard condition() else { throw BehaviorTestFailure.mismatch(message) }
    }

    private static func expectEqual<T: Equatable>(_ actual: T, _ expected: T, _ message: String) throws {
        guard actual == expected else {
            throw BehaviorTestFailure.mismatch("\(message): got \(actual), expected \(expected)")
        }
    }
}

@MainActor
private final class FakeKeyboardViewStore: KeyboardViewStore {
    private let subject: CurrentValueSubject<KeyboardViewState, Never>
    private(set) var actions: [KeyboardViewAction] = []

    init(state: KeyboardViewState) {
        subject = CurrentValueSubject(state)
    }

    var state: KeyboardViewState { subject.value }
    var statePublisher: AnyPublisher<KeyboardViewState, Never> { subject.eraseToAnyPublisher() }

    func send(_ action: KeyboardViewAction) {
        actions.append(action)
    }

    func thumbnail(for cardID: UUID, maxPixel: CGFloat) async -> KeyboardViewThumbnail? {
        nil
    }

    func publish(_ state: KeyboardViewState) {
        subject.send(state)
    }
}
