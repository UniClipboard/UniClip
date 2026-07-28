import Foundation

#if canImport(UIKit)
import UIKit
#endif

enum KeyboardLayoutMetrics {
    #if canImport(UIKit)
    static let isPad = UIDevice.current.userInterfaceIdiom == .pad
    #else
    static let isPad = false
    #endif
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

    static func targetHeight(
        hasFullAccess: Bool,
        needsInputModeSwitchKey: Bool
    ) -> CGFloat {
        let content = hasFullAccess ? contentHeight : restrictedContentHeight
        return content + (needsInputModeSwitchKey ? stripBandHeight : 0)
    }
}
