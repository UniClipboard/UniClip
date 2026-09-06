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
      const change = buildDeviceTrustDecisionView(deviceTrust);
      if (
        !change ||
        status === 'submitting' ||
        !change.choices.some((option) => option.choice === choice)
      )
        return;
      setSelection({ changeId: change.reviewId ?? change.changeId, choice });
      setConfirmingChoice(null);
    },
    [deviceTrust, status]
  );

  const proceed = useCallback(async () => {
    const change = buildDeviceTrustDecisionView(deviceTrust);
    const choice = selection.choice;
    if (
      !change ||
      !choice ||
      selection.changeId !== (change.reviewId ?? change.changeId) ||
      status === 'submitting' ||
      !change.choices.some((option) => option.choice === choice)
    ) {
      return;
    }
    const selectedView = view?.choices.find((candidate) => candidate.choice === choice);
    if (
      selectedView?.isCurrentGroup ||
      choice === 'keepCurrentDeviceGroup' ||
      selectedView?.exitsCurrentSpace ||
      Boolean(selectedView?.stopSyncNames.length)
    ) {
      setConfirmingChoice(choice);
      return;
    }
    try {
      if (deviceTrust?.groupChoices) {
        await getUnifiedSpaceService().decideDeviceTrust(
          choice,
          false,
          deviceTrust.groupChoices.revision
        );
      } else {
        await getUnifiedSpaceService().decideDeviceTrust(choice, false);
      }
    } catch {
      // The space service publishes the actionable error for this modal.
    }
  }, [deviceTrust, selection.changeId, selection.choice, status, view]);

  const confirm = useCallback(async () => {
    const change = buildDeviceTrustDecisionView(deviceTrust);
    const choice = confirmingChoice;
    if (
      !change ||
      !choice ||
      status === 'submitting' ||
      selection.changeId !== (change.reviewId ?? change.changeId)
    )
      return;
    setConfirmingChoice(null);
    try {
      const removesLocal = Boolean(
        change.choices.find((option) => option.choice === choice)?.exitsCurrentSpace
      );
      if (deviceTrust?.groupChoices) {
        await getUnifiedSpaceService().decideDeviceTrust(
          choice,
          removesLocal,
          deviceTrust.groupChoices.revision
        );
      } else {
        await getUnifiedSpaceService().decideDeviceTrust(choice, removesLocal);
      }
    } catch {
      // The space service publishes the actionable error for this modal.
    }
  }, [confirmingChoice, deviceTrust, status, selection.changeId]);

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
