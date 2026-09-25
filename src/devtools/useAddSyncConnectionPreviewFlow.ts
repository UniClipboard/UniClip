import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DeviceTrustSnapshot, InvitationIssued } from '@/platform/engine';
import type { AddSyncConnectionPreviewScenarioId } from '@/components/AddSyncConnectionSheet.types';
import type {
  AddSyncConnectionFlow,
  AddSyncConnectionFlowState,
} from '@/components/useAddSyncConnectionFlow';

export const ADD_SYNC_CONNECTION_PREVIEW_SCENARIOS: ReadonlyArray<{
  id: AddSyncConnectionPreviewScenarioId;
  labelKey: string;
}> = [
  { id: 'joinPending', labelKey: 'debug.connectionSheetPreview.scenarios.joinPending' },
  { id: 'joinProcessing', labelKey: 'debug.connectionSheetPreview.scenarios.joinProcessing' },
  {
    id: 'joinTakingLonger',
    labelKey: 'debug.connectionSheetPreview.scenarios.joinTakingLonger',
  },
  { id: 'joinCancelling', labelKey: 'debug.connectionSheetPreview.scenarios.joinCancelling' },
  { id: 'joinFailed', labelKey: 'debug.connectionSheetPreview.scenarios.joinFailed' },
  { id: 'deviceUpdating', labelKey: 'debug.connectionSheetPreview.scenarios.deviceUpdating' },
  { id: 'deviceRetrying', labelKey: 'debug.connectionSheetPreview.scenarios.deviceRetrying' },
  {
    id: 'deviceStateRejected',
    labelKey: 'debug.connectionSheetPreview.scenarios.deviceStateRejected',
  },
  {
    id: 'deviceRelationshipConflict',
    labelKey: 'debug.connectionSheetPreview.scenarios.deviceRelationshipConflict',
  },
  {
    id: 'deviceSecurityUpdateRejected',
    labelKey: 'debug.connectionSheetPreview.scenarios.deviceSecurityUpdateRejected',
  },
  {
    id: 'deviceUpgradeRequired',
    labelKey: 'debug.connectionSheetPreview.scenarios.deviceUpgradeRequired',
  },
  {
    id: 'localIdentityMismatch',
    labelKey: 'debug.connectionSheetPreview.scenarios.localIdentityMismatch',
  },
  { id: 'deviceUpdated', labelKey: 'debug.connectionSheetPreview.scenarios.deviceUpdated' },
  { id: 'inviterWaiting', labelKey: 'debug.connectionSheetPreview.scenarios.inviterWaiting' },
  {
    id: 'invitationExpired',
    labelKey: 'debug.connectionSheetPreview.scenarios.invitationExpired',
  },
  {
    id: 'inviterConnected',
    labelKey: 'debug.connectionSheetPreview.scenarios.inviterConnected',
  },
];

const invitation: InvitationIssued = {
  invitationCode: '123-456',
  fullInvitation: 'preview-only',
  expiresAtMs: Date.now() + 5 * 60_000,
  availability: 'crossNetwork',
};

const updating: DeviceTrustSnapshot['spaceDeviceUpdate'] = {
  phase: 'updating',
  reason: null,
  recovery: null,
  nextRetryAtMs: null,
};

export function createAddSyncConnectionPreviewState(
  id: AddSyncConnectionPreviewScenarioId,
  operationFailed: string
): AddSyncConnectionFlowState {
  const base: AddSyncConnectionFlowState = {
    mode: 'joinDetails',
    deviceName: 'This development phone',
    passphrase: 'preview-only',
    invitationCode: '123456',
    invitation: null,
    pending: false,
    joinSubmitted: false,
    restoredJoin: false,
    joinTakingLonger: false,
    cancellingJoin: false,
    error: null,
    copied: false,
    canSubmitDetails: true,
    codeComplete: true,
    invitationExpired: false,
    invitationTimeRemaining: '4:59',
    remoteDeviceName: null,
    peerUpgradeRequired: false,
    deviceUpdate: updating,
    removalAcknowledgementPending: false,
  };

  switch (id) {
    case 'joinPending':
      return { ...base, pending: true, joinSubmitted: true };
    case 'joinProcessing':
      return { ...base, pending: true, joinSubmitted: true, restoredJoin: true };
    case 'joinTakingLonger':
      return { ...base, pending: true, joinSubmitted: true, joinTakingLonger: true };
    case 'joinCancelling':
      return { ...base, pending: true, joinSubmitted: true, cancellingJoin: true };
    case 'joinFailed':
      return { ...base, joinSubmitted: true, error: operationFailed };
    case 'deviceUpdating':
      return { ...base, mode: 'joinUpdating' };
    case 'deviceRetrying':
      return {
        ...base,
        mode: 'joinUpdating',
        deviceUpdate: { ...updating, phase: 'retryableFailure', nextRetryAtMs: Date.now() + 30_000 },
      };
    case 'deviceStateRejected':
    case 'deviceRelationshipConflict':
    case 'deviceSecurityUpdateRejected':
    case 'deviceUpgradeRequired':
      return {
        ...base,
        mode: 'joinUpdating',
        deviceUpdate: {
          ...updating,
          phase: 'needsAttention',
          reason: id,
          recovery: id === 'deviceUpgradeRequired' ? 'updateApp' : 'reviewDevices',
        },
      };
    case 'localIdentityMismatch':
      // Engine offers no recovery for this reason.
      return {
        ...base,
        mode: 'joinUpdating',
        deviceUpdate: { ...updating, phase: 'needsAttention', reason: id },
      };
    case 'deviceUpdated':
      return { ...base, mode: 'joinReady', deviceUpdate: { ...updating, phase: 'completed' } };
    case 'inviterWaiting':
      return { ...base, mode: 'invitation', invitation };
    case 'invitationExpired':
      return {
        ...base,
        mode: 'invitation',
        invitation: { ...invitation, expiresAtMs: Date.now() - 1_000 },
        invitationExpired: true,
        invitationTimeRemaining: '0:00',
      };
    case 'inviterConnected':
      return {
        ...base,
        mode: 'success',
        remoteDeviceName: 'Example computer with a longer device name',
      };
  }
}

export function useAddSyncConnectionPreviewFlow(
  scenarioId: AddSyncConnectionPreviewScenarioId,
  onClose: () => void
): AddSyncConnectionFlow {
  const { t } = useTranslation('settingsSync');
  const operationFailed = t('space.error.operationFailed');
  const [state, setState] = useState(() =>
    createAddSyncConnectionPreviewState(scenarioId, operationFailed)
  );

  useEffect(() => {
    setState(createAddSyncConnectionPreviewState(scenarioId, operationFailed));
  }, [operationFailed, scenarioId]);

  const actions = useMemo<AddSyncConnectionFlow['actions']>(
    () => ({
      setDeviceName: (value) => setState((current) => ({ ...current, deviceName: value })),
      setPassphrase: () => undefined,
      updateInvitationCode: () => undefined,
      continueFromCode: () => undefined,
      selectMode: () => undefined,
      back: onClose,
      close: onClose,
      submitCreate: async () => undefined,
      submitJoin: async () => undefined,
      editJoinDetails: () =>
        setState((current) => ({
          ...current,
          joinSubmitted: false,
          restoredJoin: false,
          error: null,
        })),
      cancelJoin: async () =>
        setState((current) => ({ ...current, pending: true, cancellingJoin: true })),
      renewInvitation: async () =>
        setState((current) => ({
          ...current,
          invitation,
          invitationExpired: false,
          invitationTimeRemaining: '4:59',
        })),
      copyInvitation: async () => setState((current) => ({ ...current, copied: true })),
      shareInvitation: async () => undefined,
      completeConnection: async () => onClose(),
    }),
    [onClose]
  );

  return { state, actions };
}
