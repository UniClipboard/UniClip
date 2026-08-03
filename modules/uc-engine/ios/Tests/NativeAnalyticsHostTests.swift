import Foundation
import XCTest

@testable import UcEngineSystemHost

final class NativeAnalyticsHostTests: XCTestCase {
  func testStoresShareConsentAndIdentities() throws {
    let fixture = try makeFixture()
    defer { fixture.cleanup() }
    let first = try AppleAnalyticsStore(defaults: fixture.defaults, queueDirectory: fixture.queue)
    let second = try AppleAnalyticsStore(defaults: fixture.defaults, queueDirectory: fixture.queue)

    XCTAssertEqual(try first.anonymousID(), try second.anonymousID())
    XCTAssertEqual(try first.deviceID(), try second.deviceID())

    try first.setEnabled(false)
    XCTAssertFalse(second.isEnabled)

    let spacePerson = UUID().uuidString.lowercased()
    _ = try first.adopt(spacePerson)
    XCTAssertEqual(second.currentSpacePersonID(), spacePerson)
  }

  func testCaptureBuildsPostHogEnvelopeAndPreservesQueueOrder() throws {
    let fixture = try makeFixture()
    defer { fixture.cleanup() }
    let store = try AppleAnalyticsStore(defaults: fixture.defaults, queueDirectory: fixture.queue)
    let host = try makeHost(store: store)

    try host.identify(
      payload: BindingAnalyticsIdentify(
        oldDistinctId: UUID().uuidString.lowercased(),
        newDistinctId: UUID().uuidString.lowercased(),
        setJson: "{}",
        setOnceJson: "{}"
      )
    )
    try host.capture(event: BindingAnalyticsEvent(name: "sync_succeeded", propertiesJson: "{\"direction\":\"outbound\"}"))

    let events = try store.pendingEvents().map(readBody)
    XCTAssertEqual(events.compactMap { $0["event"] as? String }, ["$identify", "sync_succeeded"])

    let capture = try XCTUnwrap(events.last)
    XCTAssertEqual(capture["api_key"] as? String, "phc_native_test")
    XCTAssertNotNil(capture["distinct_id"] as? String)
    let properties = try XCTUnwrap(capture["properties"] as? [String: Any])
    XCTAssertEqual(properties["direction"] as? String, "outbound")
    XCTAssertEqual(properties["app_version"] as? String, "1.2.3")
    XCTAssertEqual(properties["$geoip_disable"] as? Bool, true)
    XCTAssertNotNil(properties["$insert_id"] as? String)
    XCTAssertNotNil(properties["$device_id"] as? String)
    XCTAssertNotNil(properties["$session_id"] as? String)
  }

  func testConsentStopsCaptureAndClearsPendingEvents() throws {
    let fixture = try makeFixture()
    defer { fixture.cleanup() }
    let store = try AppleAnalyticsStore(defaults: fixture.defaults, queueDirectory: fixture.queue)
    let host = try makeHost(store: store)

    try host.capture(event: BindingAnalyticsEvent(name: "app_opened", propertiesJson: "{}"))
    XCTAssertEqual(store.pendingEvents().count, 1)

    try host.setConsentEnabled(false)
    XCTAssertTrue(store.pendingEvents().isEmpty)
    try host.capture(event: BindingAnalyticsEvent(name: "app_opened", propertiesJson: "{}"))
    XCTAssertTrue(store.pendingEvents().isEmpty)
  }

  func testResetRotatesEveryIdentityWithoutLinkingTheOldPerson() throws {
    let fixture = try makeFixture()
    defer { fixture.cleanup() }
    let store = try AppleAnalyticsStore(defaults: fixture.defaults, queueDirectory: fixture.queue)
    let host = try makeHost(store: store)
    let oldAnonymous = try store.anonymousID()
    let oldDevice = try store.deviceID()
    _ = try store.adopt(UUID().uuidString.lowercased())
    try host.capture(event: BindingAnalyticsEvent(name: "app_opened", propertiesJson: "{}"))

    try host.resetAndIdentify()

    XCTAssertNotEqual(try store.anonymousID(), oldAnonymous)
    XCTAssertNotEqual(try store.deviceID(), oldDevice)
    XCTAssertNil(store.currentSpacePersonID())
    XCTAssertTrue(store.pendingEvents().isEmpty)
  }

  func testGroupIdentifyUsesCurrentPersonAndDeduplicationID() throws {
    let fixture = try makeFixture()
    defer { fixture.cleanup() }
    let store = try AppleAnalyticsStore(defaults: fixture.defaults, queueDirectory: fixture.queue)
    let host = try makeHost(store: store)

    try host.groupIdentify(
      payload: BindingAnalyticsGroupIdentify(
        groupType: "space",
        groupKey: "0123456789abcdef",
        setJson: "{\"device_count\":2}"
      )
    )

    let body = try readBody(XCTUnwrap(store.pendingEvents().first))
    XCTAssertEqual(body["event"] as? String, "$groupidentify")
    XCTAssertEqual(body["distinct_id"] as? String, try store.currentDistinctID())
    let properties = try XCTUnwrap(body["properties"] as? [String: Any])
    XCTAssertEqual(properties["$group_type"] as? String, "space")
    XCTAssertEqual(properties["$group_key"] as? String, "0123456789abcdef")
    XCTAssertNotNil(properties["$insert_id"] as? String)
  }

  func testSensitivePropertiesAndPathValuesAreRejected() throws {
    let fixture = try makeFixture()
    defer { fixture.cleanup() }
    let store = try AppleAnalyticsStore(defaults: fixture.defaults, queueDirectory: fixture.queue)
    let host = try makeHost(store: store)

    XCTAssertThrowsError(
      try host.capture(
        event: BindingAnalyticsEvent(name: "sync_succeeded", propertiesJson: "{\"file_name\":\"private.txt\"}")
      )
    )
    XCTAssertThrowsError(
      try host.capture(
        event: BindingAnalyticsEvent(name: "sync_succeeded", propertiesJson: "{\"value\":\"file:///Users/example/private.txt\"}")
      )
    )
    XCTAssertTrue(store.pendingEvents().isEmpty)
  }

  private func makeHost(store: AppleAnalyticsStore) throws -> ApplePostHogAnalyticsHost {
    try ApplePostHogAnalyticsHost(
      appVersion: "1.2.3",
      store: store,
      projectKey: "phc_native_test",
      endpoint: URL(string: "http://127.0.0.1:1/i/v0/e/")!
    )
  }

  private func readBody(_ url: URL) throws -> [String: Any] {
    try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
  }

  private func makeFixture() throws -> Fixture {
    let identifier = "NativeAnalyticsHostTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: identifier))
    defaults.removePersistentDomain(forName: identifier)
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent(identifier, isDirectory: true)
    return Fixture(identifier: identifier, defaults: defaults, queue: directory.appendingPathComponent("queue"))
  }
}

private struct Fixture {
  let identifier: String
  let defaults: UserDefaults
  let queue: URL

  func cleanup() {
    defaults.removePersistentDomain(forName: identifier)
    try? FileManager.default.removeItem(at: queue.deletingLastPathComponent())
  }
}
