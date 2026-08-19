import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import type { DeviceTrustDecisionSession } from '../components/DeviceTrustDecisionSession';
import { useActiveDeviceTrustDecisionSession } from '../components/useActiveDeviceTrustDecisionSession';
import { deviceTrustPreviewSession } from '../devtools/deviceTrustPreviewSession';
import { createInitialUnifiedSpaceSnapshot, useUnifiedSpaceStore } from '../features/space/store';
import type { DeviceTrustSnapshot } from '../platform/engine';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockDecideDeviceTrust = jest.fn();

jest.mock('@/features/space', () => {
  const actual = jest.requireActual('@/features/space');
  return {
    ...actual,
    getUnifiedSpaceService: () => ({ decideDeviceTrust: mockDecideDeviceTrust }),
  };
});

let currentSession!: DeviceTrustDecisionSession;
let renderer: TestRenderer.ReactTestRenderer | null = null;

function Harness() {
  currentSession = useActiveDeviceTrustDecisionSession();
  return null;
}

function realDecision(): DeviceTrustSnapshot {
  return {
    revision: 42,
    localDeviceId: 'real-phone',
    localMembership: 'active',
    currentChange: {
      changeId: 'real-change',
      proposedByDeviceId: 'real-desktop',
      targetDeviceIds: ['real-tablet'],
      includesLocalDevice: false,
      applyImpact: {
        usableDeviceIds: ['real-phone', 'real-desktop', 'real-tablet'],
        pausedDeviceIds: [],
        localDeviceOutcome: 'active',
        requiresRejoinDeviceIds: [],
      },
      keepCurrentImpact: {
        usableDeviceIds: ['real-phone', 'real-desktop'],
        pausedDeviceIds: ['real-tablet'],
        localDeviceOutcome: 'active',
        requiresRejoinDeviceIds: ['real-tablet'],
      },
      allowedChoices: ['applyChange', 'keepCurrentDeviceGroup'],
      blockedReason: null,
    },
    devices: [
      {
        deviceId: 'real-phone',
        displayName: 'Real phone',
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
        deviceId: 'real-desktop',
        displayName: 'Real desktop',
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
        deviceId: 'real-tablet',
        displayName: 'Real tablet',
        isLocal: false,
        reachability: 'online',
        membership: 'active',
        groupRelationship: 'pendingLocalDecision',
        compatibility: 'compatible',
        syncRelationship: 'waitingForLocalDecision',
        availableActions: [],
        blockedReason: null,
      },
    ],
    recovery: 'notAvailableInThisVersion',
    allowedActions: ['applyCurrentChange', 'keepCurrentDeviceGroup'],
    blockedReason: null,
    updatedAtMs: 42,
  };
}

describe('active device trust decision session', () => {
  beforeEach(() => {
    mockDecideDeviceTrust.mockClear();
    deviceTrustPreviewSession.close();
    useUnifiedSpaceStore.setState(createInitialUnifiedSpaceSnapshot('ready'), true);
  });

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('routes preview actions only to the in-memory session', async () => {
    deviceTrustPreviewSession.open('standard');
    const authoritativeBefore = useUnifiedSpaceStore.getState();

    act(() => {
      renderer = TestRenderer.create(<Harness />);
    });
    await act(async () => currentSession.choose('applyChange'));
    await act(async () => currentSession.proceed());

    expect(mockDecideDeviceTrust).not.toHaveBeenCalled();
    expect(useUnifiedSpaceStore.getState()).toBe(authoritativeBefore);
    expect(currentSession.changeId).toBeNull();
    expect(deviceTrustPreviewSession.getState().session).toBeNull();
  });

  it('immediately replaces a preview when a real decision arrives', () => {
    deviceTrustPreviewSession.open('longScrollable');
    act(() => {
      renderer = TestRenderer.create(<Harness />);
    });
    expect(currentSession.changeId).toBe('preview-long-scrollable');

    const real = realDecision();
    act(() => {
      useUnifiedSpaceStore.setState({ deviceTrustQuery: { kind: 'ready', snapshot: real } });
    });

    expect(currentSession.changeId).toBe('real-change');
    expect(currentSession.view?.choices.map(({ choice }) => choice)).toEqual([
      'applyChange',
      'keepCurrentDeviceGroup',
    ]);
    expect(deviceTrustPreviewSession.getState().session).toBeNull();
    expect(
      useUnifiedSpaceStore.getState().deviceTrustQuery.kind === 'ready'
        ? useUnifiedSpaceStore.getState().deviceTrustQuery.snapshot
        : null
    ).toBe(real);
  });
});
