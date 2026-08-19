import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildDeviceTrustDecisionView,
  deviceTrustSnapshotFromQuery,
  getUnifiedSpaceService,
  initialDeviceTrustChoice,
  useUnifiedSpaceStore,
} from '@/features/space';
import type { DeviceTrustChoice } from '@/platform/engine';
import type { DeviceTrustDecisionSession } from './DeviceTrustDecisionSession';

export function useDeviceTrustDecision(): DeviceTrustDecisionSession {
  const deviceTrustQuery = useUnifiedSpaceStore((state) => state.deviceTrustQuery);
  const deviceTrust = deviceTrustSnapshotFromQuery(deviceTrustQuery);
  const status = useUnifiedSpaceStore((state) => state.deviceTrustDecisionStatus);
  const error = useUnifiedSpaceStore((state) => state.deviceTrustDecisionError);
  const outcome = useUnifiedSpaceStore((state) => state.deviceTrustDecisionOutcome);
  const operationState = useUnifiedSpaceStore((state) => state.operationState);
  const [selection, setSelection] = useState<{
    changeId: string | null;
    choice: DeviceTrustChoice | null;
  }>({ changeId: null, choice: null });
  const [confirmingChoice, setConfirmingChoice] = useState<DeviceTrustChoice | null>(null);

  useEffect(() => {
    const next = initialDeviceTrustChoice(deviceTrust, selection.changeId, selection.choice);
    if (next.changeId === selection.changeId && next.choice === selection.choice) return;
    setSelection(next);
    setConfirmingChoice(null);
  }, [deviceTrust, selection.changeId, selection.choice]);

  const view = useMemo(
    () => (operationState.kind === 'result' ? null : buildDeviceTrustDecisionView(deviceTrust)),
    [deviceTrust, operationState.kind]
  );

  const choose = useCallback(
    async (choice: DeviceTrustChoice) => {
      const change = deviceTrust?.currentChange;
      if (!change || status === 'submitting' || !change.allowedChoices.includes(choice)) return;
      setSelection({ changeId: change.changeId, choice });
      setConfirmingChoice(null);
    },
    [deviceTrust, status]
  );

  const proceed = useCallback(async () => {
    const change = deviceTrust?.currentChange;
    const choice = selection.choice;
    if (
      !change ||
      !choice ||
      selection.changeId !== change.changeId ||
      status === 'submitting' ||
      !change.allowedChoices.includes(choice)
    ) {
      return;
    }
    const selectedView = view?.choices.find((candidate) => candidate.choice === choice);
    if (
      choice === 'keepCurrentDeviceGroup' ||
      change.includesLocalDevice ||
      Boolean(selectedView?.stopSyncNames.length)
    ) {
      setConfirmingChoice(choice);
      return;
    }
    try {
      await getUnifiedSpaceService().decideDeviceTrust(choice, false);
    } catch {
      // The space service publishes the actionable error for this modal.
    }
  }, [deviceTrust, selection.changeId, selection.choice, status, view]);

  const confirm = useCallback(async () => {
    const change = deviceTrust?.currentChange;
    const choice = confirmingChoice;
    if (!change || !choice || status === 'submitting') return;
    setConfirmingChoice(null);
    try {
      await getUnifiedSpaceService().decideDeviceTrust(
        choice,
        choice === 'applyChange' && change.includesLocalDevice
      );
    } catch {
      // The space service publishes the actionable error for this modal.
    }
  }, [confirmingChoice, deviceTrust, status]);

  const cancelConfirmation = useCallback(() => setConfirmingChoice(null), []);

  return {
    view,
    changeId: view?.changeId ?? null,
    selectedChoice: selection.choice,
    confirmingChoice,
    submitting: status === 'submitting',
    error,
    outcome,
    choose,
    proceed,
    confirm,
    cancelConfirmation,
    dismiss: null,
  };
}
