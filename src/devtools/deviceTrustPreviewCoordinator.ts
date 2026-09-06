import * as Application from 'expo-application';

import { deviceTrustSnapshotFromQuery, buildDeviceTrustDecisionView } from '@/features/space';
import { useUnifiedSpaceStore, type UnifiedSpaceSnapshot } from '@/features/space/store';
import {
  deviceTrustPreviewSession,
  type DeviceTrustPreviewScenarioId,
} from './deviceTrustPreviewSession';

export function isDeviceTrustPreviewAvailable(): boolean {
  return Application.applicationId?.endsWith('.dev') === true;
}

export function canOpenDeviceTrustPreview(): boolean {
  return (
    isDeviceTrustPreviewAvailable() &&
    !hasAuthoritativeDeviceTrustWork(useUnifiedSpaceStore.getState())
  );
}

export function hasAuthoritativeDeviceTrustWork(state: UnifiedSpaceSnapshot): boolean {
  return (
    buildDeviceTrustDecisionView(deviceTrustSnapshotFromQuery(state.deviceTrustQuery)) != null ||
    state.deviceTrustDecisionStatus === 'submitting' ||
    state.deviceTrustDecisionError !== null ||
    state.deviceTrustDecisionOutcome !== null ||
    state.operationState.kind !== 'idle'
  );
}

export function openDeviceTrustPreview(id: DeviceTrustPreviewScenarioId): boolean {
  if (!canOpenDeviceTrustPreview()) return false;
  deviceTrustPreviewSession.open(id);
  return true;
}

export function closeDeviceTrustPreview(): void {
  deviceTrustPreviewSession.close();
}
