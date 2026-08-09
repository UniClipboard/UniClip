import Foundation

private enum PresentationTestFailure: Error, CustomStringConvertible {
    case mismatch(String)

    var description: String {
        switch self {
        case .mismatch(let message): message
        }
    }
}

@main
private enum ShareRecipientLoadErrorPresentationTests {
    static func main() {
        do {
            try run()
            print("PASS: share recipient-load error presentation checks")
        } catch {
            fputs("FAIL: \(error)\n", stderr)
            exit(1)
        }
    }

    private static func run() throws {
        try verifyCategoryRawValues()
        try verifyUnknownErrorsCollapseToOther()
        try verifyMessageKeys()

        print("OK: \(RecipientLoadErrorCategory.runtimeBusy.rawValue)")
        print("OK: \(RecipientLoadErrorCategory.sharedStoreUnavailable.rawValue)")
        print("OK: \(RecipientLoadErrorCategory.spaceUnavailable.rawValue)")
        print("OK: \(RecipientLoadErrorCategory.other.rawValue)")
    }

    private static func verifyCategoryRawValues() throws {
        try expectEqual(
            RecipientLoadErrorCategory.runtimeBusy.rawValue,
            "runtime_busy",
            "the runtime-busy category must keep its diagnostics-compatible raw value"
        )
        try expectEqual(
            RecipientLoadErrorCategory.sharedStoreUnavailable.rawValue,
            "shared_store_unavailable",
            "the shared-store category must keep its diagnostics-compatible raw value"
        )
        try expectEqual(
            RecipientLoadErrorCategory.spaceUnavailable.rawValue,
            "space_unavailable",
            "the space category must keep its diagnostics-compatible raw value"
        )
        try expectEqual(
            RecipientLoadErrorCategory.other.rawValue,
            "other",
            "the fallback category must keep its diagnostics-compatible raw value"
        )
    }

    private static func verifyUnknownErrorsCollapseToOther() throws {
        let generic = NSError(domain: "test.uniclip", code: 1)
        try expectEqual(
            RecipientLoadErrorPresentation.category(for: generic),
            .other,
            "an unrecognized error must collapse to the generic category"
        )
    }

    private static func verifyMessageKeys() throws {
        try expectEqual(
            RecipientLoadErrorPresentation.messageKey(for: .runtimeBusy),
            "主程序正在同步，请稍后重试",
            "a busy runtime must get an actionable retry message"
        )
        try expectEqual(
            RecipientLoadErrorPresentation.messageKey(for: .sharedStoreUnavailable),
            "请先打开 UniClip 主程序完成设置",
            "a missing shared store must instruct opening the main app"
        )
        try expectEqual(
            RecipientLoadErrorPresentation.messageKey(for: .spaceUnavailable),
            "尚未加入空间，请先打开 UniClip 主程序加入",
            "a missing space must instruct joining one from the main app"
        )
        try expectEqual(
            RecipientLoadErrorPresentation.messageKey(for: .other),
            "无法读取接收设备",
            "unknown categories must keep the generic recipient-reading message"
        )
    }

    private static func expect(_ condition: @autoclosure () -> Bool, _ message: String) throws {
        guard condition() else { throw PresentationTestFailure.mismatch(message) }
    }

    private static func expectEqual<T: Equatable>(_ actual: T, _ expected: T, _ message: String) throws {
        guard actual == expected else {
            throw PresentationTestFailure.mismatch("\(message): got \(actual), expected \(expected)")
        }
    }
}
