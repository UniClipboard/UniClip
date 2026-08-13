import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { useUnifiedSpaceStore } from '../features/space';
import { createInitialUnifiedSpaceSnapshot } from '../features/space/store';
import { useDeviceTrustDecision } from '../components/useDeviceTrustDecision';
import type { DeviceTrustSnapshot } from '../platform/engine';

const mockDecideDeviceTrust = jest.fn(async () => ({ kind: 'applied' }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../features/space/internal/spaceService', () => {
  const actual = jest.requireActual('../features/space/internal/spaceService');
  return {
    ...actual,
    getUnifiedSpaceService: () => ({ decideDeviceTrust: mockDecideDeviceTrust }),
  };
});

function trust(changeId = 'change-1', includesLocalDevice = false): DeviceTrustSnapshot {
  return {
    revision: 1,
    localDeviceId: 'phone-1',
    localMembership: 'active',
    currentChange: {
      changeId,
      proposedByDeviceId: 'desktop-1',
      targetDeviceIds: includesLocalDevice ? ['phone-1'] : ['tablet-1'],
      includesLocalDevice,
      applyImpact: {
        usableDeviceIds: ['desktop-1'],
        pausedDeviceIds: includesLocalDevice ? ['phone-1'] : ['tablet-1'],
        localDeviceOutcome: includesLocalDevice ? 'removed' : 'active',
        requiresRejoinDeviceIds: [],
      },
      keepCurrentImpact: {
        usableDeviceIds: ['phone-1', 'tablet-1'],
        pausedDeviceIds: ['desktop-1'],
        localDeviceOutcome: 'active',
        requiresRejoinDeviceIds: ['desktop-1'],
      },
      allowedChoices: ['applyChange', 'keepCurrentDeviceGroup'],
      blockedReason: null,
    },
    devices: [
      {
        deviceId: 'phone-1',
        displayName: 'Phone',
        isLocal: true,
        reachability: 'online',
        membership: 'active',
        groupRelationship: 'pendingLocalDecision',
        compatibility: 'compatible',
        syncRelationship: 'waitingForLocalDecision',
        availableActions: [],
        blockedReason: null,
      },
      {
        deviceId: 'desktop-1',
        displayName: 'Desktop',
        isLocal: false,
        reachability: 'online',
        membership: 'active',
        groupRelationship: 'pendingLocalDecision',
        compatibility: 'compatible',
        syncRelationship: 'waitingForLocalDecision',
        availableActions: [],
        blockedReason: null,
      },
      {
        deviceId: 'tablet-1',
        displayName: 'Tablet',
        isLocal: false,
        reachability: 'offline',
        membership: 'active',
        groupRelationship: 'unknown',
        compatibility: 'compatible',
        syncRelationship: 'unknown',
        availableActions: [],
        blockedReason: null,
      },
    ],
    recovery: 'notAvailableInThisVersion',
    allowedActions: ['applyCurrentChange', 'keepCurrentDeviceGroup'],
    blockedReason: null,
    updatedAtMs: 1,
  };
}

function publish(deviceTrust: DeviceTrustSnapshot | null) {
  useUnifiedSpaceStore.setState(
    { ...createInitialUnifiedSpaceSnapshot('ready'), spaceId: 'space-1', deviceTrust },
    true
  );
}

type DecisionController = ReturnType<typeof useDeviceTrustDecision>;
let currentDecision!: DecisionController;
let activeRenderer: ReactTestRenderer | null = null;

function Harness() {
  currentDecision = useDeviceTrustDecision();
  return null;
}

function createHarness() {
  act(() => {
    activeRenderer = TestRenderer.create(<Harness />);
  });
}

describe('useDeviceTrustDecision', () => {
  beforeEach(() => {
    mockDecideDeviceTrust.mockClear();
    publish(trust());
  });

  afterEach(() => {
    if (activeRenderer) act(() => activeRenderer?.unmount());
    activeRenderer = null;
  });

  it('submits a non-local apply choice directly', async () => {
    createHarness();

    await act(async () => currentDecision.choose('applyChange'));

    expect(mockDecideDeviceTrust).toHaveBeenCalledWith('applyChange', false);
    expect(currentDecision.confirmingChoice).toBeNull();
  });

  it('requires confirmation before keeping the current device group', async () => {
    createHarness();

    await act(async () => currentDecision.choose('keepCurrentDeviceGroup'));
    expect(mockDecideDeviceTrust).not.toHaveBeenCalled();
    expect(currentDecision.confirmingChoice).toBe('keepCurrentDeviceGroup');

    await act(async () => currentDecision.confirm());
    expect(mockDecideDeviceTrust).toHaveBeenCalledWith('keepCurrentDeviceGroup', false);
  });

  it('requires explicit local-removal confirmation and sends it only then', async () => {
    publish(trust('change-local', true));
    createHarness();

    await act(async () => currentDecision.choose('applyChange'));
    expect(mockDecideDeviceTrust).not.toHaveBeenCalled();
    await act(async () => currentDecision.confirm());
    expect(mockDecideDeviceTrust).toHaveBeenCalledWith('applyChange', true);
  });

  it('keeps a failed direct decision inside the decision UI', async () => {
    mockDecideDeviceTrust.mockRejectedValueOnce(new Error('decision failed'));
    createHarness();

    await act(async () => {
      await expect(currentDecision.choose('applyChange')).resolves.toBeUndefined();
    });
    expect(mockDecideDeviceTrust).toHaveBeenCalledWith('applyChange', false);
  });

  it('keeps a failed confirmed decision inside the decision UI', async () => {
    mockDecideDeviceTrust.mockRejectedValueOnce(new Error('decision failed'));
    publish(trust('change-local', true));
    createHarness();

    await act(async () => currentDecision.choose('applyChange'));
    await act(async () => {
      await expect(currentDecision.confirm()).resolves.toBeUndefined();
    });
    expect(mockDecideDeviceTrust).toHaveBeenCalledWith('applyChange', true);
  });

  it('clears confirmation when Engine switches to another change', async () => {
    createHarness();
    await act(async () => currentDecision.choose('keepCurrentDeviceGroup'));

    act(() => publish(trust('change-2')));

    expect(currentDecision.changeId).toBe('change-2');
    expect(currentDecision.confirmingChoice).toBeNull();
  });
});
