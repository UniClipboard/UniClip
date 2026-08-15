import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  buildCurrentSpaceDeviceViews,
  buildSpaceOverviewView,
  getUnifiedSpaceService,
  useUnifiedSpaceStore,
} from '@/features/space';

export interface UseSpaceDeviceManagementOptions {
  allowHighImpactActions: boolean;
}

export function useSpaceDeviceManagement({
  allowHighImpactActions,
}: UseSpaceDeviceManagementOptions) {
  const spaceStatus = useUnifiedSpaceStore((state) => state.status);
  const rosterDevices = useUnifiedSpaceStore((state) => state.devices);
  const deviceTrustQuery = useUnifiedSpaceStore((state) => state.deviceTrustQuery);
  const deviceListRefreshStatus = useUnifiedSpaceStore((state) => state.deviceListRefreshStatus);
  const operationState = useUnifiedSpaceStore((state) => state.operationState);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [removeError, setRemoveError] = useState<unknown>(null);
  const removeInFlight = useRef(false);

  const devices = useMemo(
    () => buildCurrentSpaceDeviceViews(deviceTrustQuery, rosterDevices, operationState),
    [deviceTrustQuery, operationState, rosterDevices]
  );
  const overview = useMemo(
    () =>
      buildSpaceOverviewView(
        spaceStatus,
        deviceTrustQuery,
        deviceListRefreshStatus,
        rosterDevices,
        operationState
      ),
    [deviceListRefreshStatus, deviceTrustQuery, operationState, rosterDevices, spaceStatus]
  );
  const selectedDevice = useMemo(
    () => devices.find((device) => device.deviceId === selectedDeviceId) ?? null,
    [devices, selectedDeviceId]
  );
  const highImpactActionsAvailable =
    deviceTrustQuery.kind === 'ready' &&
    operationState.kind === 'idle' &&
    !overview.hasPendingDecision;
  const canRemoveSelected = Boolean(
    allowHighImpactActions &&
      selectedDevice &&
      !selectedDevice.isLocal &&
      selectedDevice.canRemove &&
      highImpactActionsAvailable &&
      !removeInFlight.current
  );

  useEffect(() => {
    if (selectedDeviceId && !selectedDevice) {
      setSelectedDeviceId(null);
      setConfirmingRemoval(false);
      setRemoveError(null);
    }
  }, [selectedDevice, selectedDeviceId]);

  const openDevice = useCallback((deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setConfirmingRemoval(false);
    setRemoveError(null);
  }, []);

  const closeDevice = useCallback(() => {
    if (removeInFlight.current) return;
    setSelectedDeviceId(null);
    setConfirmingRemoval(false);
    setRemoveError(null);
  }, []);

  const requestRemove = useCallback(() => {
    if (!canRemoveSelected) return;
    setConfirmingRemoval(true);
    setRemoveError(null);
  }, [canRemoveSelected]);

  const cancelRemove = useCallback(() => {
    if (removeInFlight.current) return;
    setConfirmingRemoval(false);
  }, []);

  const confirmRemove = useCallback(async () => {
    if (!canRemoveSelected || !selectedDevice || removeInFlight.current) return;
    removeInFlight.current = true;
    setRemoveError(null);
    try {
      await getUnifiedSpaceService().removeMember(selectedDevice.deviceId);
      setConfirmingRemoval(false);
      setSelectedDeviceId(null);
    } catch (error) {
      setRemoveError(error);
    } finally {
      removeInFlight.current = false;
    }
  }, [canRemoveSelected, selectedDevice]);

  return {
    devices,
    overview,
    selectedDevice,
    confirmingRemoval,
    removing:
      operationState.kind === 'submitting' && operationState.operation.kind === 'removeMember',
    operationInProgress: operationState.kind !== 'idle',
    highImpactActionsAvailable,
    removeError,
    canRemoveSelected,
    openDevice,
    closeDevice,
    requestRemove,
    cancelRemove,
    confirmRemove,
  };
}
