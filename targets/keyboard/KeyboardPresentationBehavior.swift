import Foundation

enum KeyboardContentMode: Equatable {
    case needsFullAccess
    case cards
    case error
    case empty

    static func resolve(
        requiresFullAccess: Bool,
        displayedCardCount: Int,
        lastError: String?
    ) -> Self {
        if requiresFullAccess { return .needsFullAccess }
        if displayedCardCount > 0 { return .cards }
        if lastError != nil { return .error }
        return .empty
    }
}

enum KeyboardCardUpdateReason: String, Equatable {
    case initial
    case cards
    case gate
    case error
    case filter
    case localization
    case cardAction
    case syncButton
    case unchanged
}

struct KeyboardCardActionState<ID: Hashable>: Equatable {
    let actingID: ID?
    let actedID: ID?
}

enum KeyboardCardBatching {
    static let batchSize = 20

    static func initialVisibleCount(totalCount: Int) -> Int {
        min(max(totalCount, 0), batchSize)
    }

    static func nextVisibleCount(
        totalCount: Int,
        currentVisibleCount: Int,
        displayedIndex: Int
    ) -> Int {
        let total = max(totalCount, 0)
        let current = min(max(currentVisibleCount, 0), total)
        guard current > 0, displayedIndex >= current - 1 else { return current }
        return min(current + batchSize, total)
    }
}

struct KeyboardThumbnailRequest: Equatable {
    let cardID: UUID
    let version: String?

    func requiresReload(from previous: Self?) -> Bool {
        previous != self
    }
}

struct KeyboardCardUpdatePlan<ID: Hashable>: Equatable {
    let reason: KeyboardCardUpdateReason
    let affectedIDs: [ID]
    let insertedIDs: [ID]
    let removedIDs: [ID]
    let movedIDs: [ID]
    let reconfiguredIDs: [ID]

    var hasOperations: Bool {
        !insertedIDs.isEmpty
            || !removedIDs.isEmpty
            || !movedIDs.isEmpty
            || !reconfiguredIDs.isEmpty
    }

    static func list(
        previousIDs: [ID],
        nextIDs: [ID],
        reason: KeyboardCardUpdateReason
    ) -> Self {
        let difference = nextIDs.difference(from: previousIDs).inferringMoves()
        var insertedIDs: [ID] = []
        var removedIDs: [ID] = []
        var movedIDs: [ID] = []

        for change in difference {
            switch change {
            case .remove(_, let id, let associatedWith):
                if associatedWith == nil {
                    removedIDs.append(id)
                } else {
                    appendUnique(id, to: &movedIDs)
                }
            case .insert(_, let id, let associatedWith):
                if associatedWith == nil {
                    insertedIDs.append(id)
                } else {
                    appendUnique(id, to: &movedIDs)
                }
            }
        }

        return Self(
            reason: reason,
            affectedIDs: [],
            insertedIDs: insertedIDs,
            removedIDs: removedIDs,
            movedIDs: movedIDs,
            reconfiguredIDs: []
        )
    }

    static func cardAction(
        displayedIDs: [ID],
        previous: KeyboardCardActionState<ID>,
        current: KeyboardCardActionState<ID>
    ) -> Self {
        let displayed = Set(displayedIDs)
        var affectedIDs: [ID] = []
        for id in [previous.actingID, current.actingID, previous.actedID, current.actedID].compactMap({ $0 }) {
            guard displayed.contains(id) else { continue }
            appendUnique(id, to: &affectedIDs)
        }

        return Self(
            reason: .cardAction,
            affectedIDs: affectedIDs,
            insertedIDs: [],
            removedIDs: [],
            movedIDs: [],
            reconfiguredIDs: affectedIDs
        )
    }

    static func none(reason: KeyboardCardUpdateReason) -> Self {
        Self(
            reason: reason,
            affectedIDs: [],
            insertedIDs: [],
            removedIDs: [],
            movedIDs: [],
            reconfiguredIDs: []
        )
    }

    private static func appendUnique(_ id: ID, to ids: inout [ID]) {
        guard !ids.contains(id) else { return }
        ids.append(id)
    }
}
