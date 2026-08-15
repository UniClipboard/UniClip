export {
  configureUnifiedSpaceService,
  getUnifiedSpaceService,
  UnifiedSpaceInputError,
  DeviceTrustDecisionInputError,
  SpaceOperationInProgressError,
  UnifiedSpaceService,
  unifiedSpaceUserErrorCode,
  type ResendEntryOutcome,
  type UnifiedSpaceApi,
  type UnifiedSpaceUserErrorCode,
} from './internal/spaceService';
export { useUnifiedSpaceStore } from './store';
export type { UnifiedSpaceDevice, UnifiedSpaceSnapshot } from './store';
export {
  buildCurrentSpaceDeviceViews,
  buildDeviceTrustDecisionView,
  buildDeviceTrustDeviceViews,
  buildSpaceOverviewView,
  deviceTrustSnapshotFromQuery,
  initialDeviceTrustChoice,
  type DeviceTrustChoiceView,
  type DeviceTrustDecisionView,
  type DeviceTrustDeviceView,
  type DeviceTrustPrimaryStatus,
  type SpaceOverviewPrimaryStatus,
  type SpaceOverviewView,
} from './deviceTrustPresentation';
export {
  getSpaceSetupCompletion,
  SpaceSetupCompletionState,
  useSpaceSetupCompletionStore,
  type SpaceSetupCompletionReporter,
  type SpaceSetupCompletionStatus,
} from './internal/spaceSetupCompletion';
