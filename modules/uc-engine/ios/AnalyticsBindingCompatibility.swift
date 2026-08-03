#if SWIFT_PACKAGE
  import Foundation

  enum BindingAnalyticsHostError: Error {
    case ContextUnavailable
    case DeliveryFailed
    case PersistenceFailed
    case InvalidIdentity
  }

  struct BindingAnalyticsEvent {
    let name: String
    let propertiesJson: String
  }

  struct BindingAnalyticsIdentityChange {
    let previousDistinctId: String
    let newDistinctId: String
  }

  struct BindingAnalyticsIdentify {
    let oldDistinctId: String
    let newDistinctId: String
    let setJson: String
    let setOnceJson: String
  }

  struct BindingAnalyticsGroupIdentify {
    let groupType: String
    let groupKey: String
    let setJson: String
  }

  protocol BindingAnalyticsHost {
    func capture(event: BindingAnalyticsEvent) throws
    func identify(payload: BindingAnalyticsIdentify) throws
    func groupIdentify(payload: BindingAnalyticsGroupIdentify) throws
    func adoptSpacePerson(spacePersonId: String) throws -> BindingAnalyticsIdentityChange
    func releaseSpacePerson() throws -> BindingAnalyticsIdentityChange
    func currentSpacePersonId() throws -> String?
    func resetTelemetryIdentity() throws -> BindingAnalyticsIdentityChange
  }
#endif
