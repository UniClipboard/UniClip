import Combine
import Foundation

#if canImport(UIKit)
import UIKit
typealias KeyboardViewThumbnail = UIImage
#else
struct KeyboardViewThumbnail: Equatable {}
#endif

struct KeyboardViewState: Equatable {
    struct Layout: Equatable {
        let hasFullAccess: Bool
        let needsInputModeSwitchKey: Bool
        let returnKeyTitle: String?
    }

    struct TopBar: Equatable {
        let title: String
        let showsSearch: Bool
        let showsRefresh: Bool
    }

    struct Content: Equatable {
        enum Mode: Equatable {
            case needsFullAccess
            case cards
            case error
            case empty
        }

        let mode: Mode
        let cards: [KeyboardViewCard]
        let message: KeyboardViewMessage?
    }

    struct Strings: Equatable {
        struct EmptyTitles: Equatable {
            let all: String
            let text: String
            let link: String
            let image: String
        }

        let searchLabel: String
        let refreshLabel: String
        let closeFilterLabel: String
        let globeLabel: String
        let deleteLabel: String
        let returnLabel: String
        let spaceTitle: String
        let filterTitles: [String]
        let emptyTitles: EmptyTitles
        let emptyMessage: String
    }

    struct Sync: Equatable {
        enum Flash: Equatable {
            case success
            case failure
        }

        let isSyncing: Bool
        let flash: Flash?
    }

    let layout: Layout
    let topBar: TopBar
    let content: Content
    let strings: Strings
    let sync: Sync
}

struct KeyboardViewMessage: Equatable {
    let symbol: String
    let title: String
    let detail: String
    let actionTitle: String?
}

struct KeyboardViewCard: Identifiable, Equatable {
    enum Kind: Equatable {
        case text
        case link
        case image
    }

    let id: UUID
    let kind: Kind
    let kindTitle: String
    let title: String
    let subtitle: String?
    let time: String
    let sizeText: String?
    let actionConfirmation: String
    let isActing: Bool
    let didAct: Bool
    let thumbnailVersion: String?
}

enum KeyboardViewAction: Equatable {
    case refresh
    case activateCard(UUID)
    case insertSpace
    case insertReturn
    case deleteBackward(isRepeating: Bool)
    case advanceInputMode
    case openSettings
    case feedback
}

enum KeyboardCardFilter: Int, CaseIterable, Equatable {
    case all
    case text
    case link
    case image

    func matches(_ card: KeyboardViewCard) -> Bool {
        switch self {
        case .all: true
        case .text: card.kind == .text
        case .link: card.kind == .link
        case .image: card.kind == .image
        }
    }
}

struct KeyboardFilterPresentation: Equatable {
    let isFiltering: Bool
    let filter: KeyboardCardFilter
}

@MainActor
protocol KeyboardViewStore: AnyObject {
    var state: KeyboardViewState { get }
    var statePublisher: AnyPublisher<KeyboardViewState, Never> { get }

    func send(_ action: KeyboardViewAction)
    func thumbnail(for cardID: UUID, maxPixel: CGFloat) async -> KeyboardViewThumbnail?
}
