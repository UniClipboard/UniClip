export {
  configureUnifiedSpaceService,
  getUnifiedSpaceService,
  UnifiedSpaceInputError,
  UnifiedSpaceService,
  unifiedSpaceUserErrorCode,
  type ResendEntryOutcome,
  type UnifiedSpaceApi,
  type UnifiedSpaceUserErrorCode,
} from './internal/spaceService';
export { useUnifiedSpaceStore } from './store';
export type { UnifiedSpaceDevice, UnifiedSpaceSnapshot } from './store';
export {
  getSpaceSetupCompletion,
  SpaceSetupCompletionState,
  useSpaceSetupCompletionStore,
  type SpaceSetupCompletionReporter,
  type SpaceSetupCompletionStatus,
} from './internal/spaceSetupCompletion';
