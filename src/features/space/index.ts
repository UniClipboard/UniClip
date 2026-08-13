export {
  configureUnifiedSpaceService,
  getUnifiedSpaceService,
  UnifiedSpaceInputError,
  DeviceTrustDecisionInputError,
  UnifiedSpaceService,
  unifiedSpaceUserErrorCode,
  type ResendEntryOutcome,
  type UnifiedSpaceApi,
  type UnifiedSpaceUserErrorCode,
} from './internal/spaceService';
export { useUnifiedSpaceStore } from './store';
export type { UnifiedSpaceDevice, UnifiedSpaceSnapshot } from './store';
export {
  buildDeviceTrustDecisionView,
  buildDeviceTrustDeviceViews,
  initialDeviceTrustChoice,
  type DeviceTrustChoiceView,
  type DeviceTrustDecisionView,
  type DeviceTrustDeviceView,
  type DeviceTrustPrimaryStatus,
} from './deviceTrustPresentation';
export {
  getSpaceSetupCompletion,
  SpaceSetupCompletionState,
  useSpaceSetupCompletionStore,
  type SpaceSetupCompletionReporter,
  type SpaceSetupCompletionStatus,
} from './internal/spaceSetupCompletion';
