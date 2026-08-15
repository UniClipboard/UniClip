import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { useSpaceDeviceManagement } from '@/components/useSpaceDeviceManagement';
import { createInitialUnifiedSpaceSnapshot, useUnifiedSpaceStore } from '@/features/space/store';
import type { DeviceTrustSnapshot } from '@/platform/engine';

const mockRemoveMember = jest.fn(async () => undefined);

jest.mock('@/features/space/internal/spaceService', () => {
  const actual = jest.requireActual('@/features/space/internal/spaceService');
  return {
    ...actual,
    getUnifiedSpaceService: () => ({ removeMember: mockRemoveMember }),
  };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const trust: DeviceTrustSnapshot = {
  revision: 1,
  localDeviceId: 'phone-1',
  localMembership: 'active',
  currentChange: null,
  devices: [
    {
      deviceId: 'phone-1',
      displayName: 'Phone',
      isLocal: true,
      reachability: 'online',
      membership: 'active',
      groupRelationship: 'consistent',
      compatibility: 'compatible',
      syncRelationship: 'usable',
      availableActions: [],
      blockedReason: null,
    },
    {
      deviceId: 'desktop-1',
      displayName: 'Desktop',
      isLocal: false,
      reachability: 'offline',
      membership: 'active',
      groupRelationship: 'consistent',
      compatibility: 'compatible',
      syncRelationship: 'usable',
      availableActions: [],
      blockedReason: null,
    },
  ],
  recovery: 'notAvailableInThisVersion',
  allowedActions: [],
  blockedReason: null,
  updatedAtMs: 1,
};

function publish() {
  useUnifiedSpaceStore.setState(
    {
      ...createInitialUnifiedSpaceSnapshot('ready'),
      spaceId: 'space-1',
      devices: [
        { deviceId: 'phone-1', displayName: 'Phone', isLocal: true, online: true },
        { deviceId: 'desktop-1', displayName: 'Desktop', isLocal: false, online: false },
      ],
      deviceTrustQuery: { kind: 'ready', snapshot: trust },
      hasResolvedDeviceList: true,
    },
    true
  );
}

type Controller = ReturnType<typeof useSpaceDeviceManagement>;
let controller!: Controller;
let renderer: ReactTestRenderer | null = null;

function Harness({ allowHighImpactActions }: { allowHighImpactActions: boolean }) {
  controller = useSpaceDeviceManagement({ allowHighImpactActions });
  return null;
}

function mount(allowHighImpactActions: boolean) {
  act(() => {
    renderer = TestRenderer.create(<Harness allowHighImpactActions={allowHighImpactActions} />);
  });
}

describe('useSpaceDeviceManagement', () => {
  beforeEach(() => {
    mockRemoveMember.mockClear();
    publish();
  });

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('opens the same detail from a read-only Home entry without exposing removal', () => {
    mount(false);
    act(() => controller.openDevice('desktop-1'));

    expect(controller.selectedDevice?.displayName).toBe('Desktop');
    expect(controller.canRemoveSelected).toBe(false);
  });

  it('requires confirmation before removing a safe remote device from Settings', async () => {
    mount(true);
    act(() => controller.openDevice('desktop-1'));
    act(() => controller.requestRemove());

    expect(controller.confirmingRemoval).toBe(true);
    expect(mockRemoveMember).not.toHaveBeenCalled();

    await act(async () => controller.confirmRemove());
    expect(mockRemoveMember).toHaveBeenCalledWith('desktop-1');
  });

  it('never offers removal for the local device', () => {
    mount(true);
    act(() => controller.openDevice('phone-1'));

    expect(controller.selectedDevice?.isLocal).toBe(true);
    expect(controller.canRemoveSelected).toBe(false);
    act(() => controller.requestRemove());
    expect(controller.confirmingRemoval).toBe(false);
  });

  it('closes stale detail when the selected device leaves the current space', () => {
    mount(true);
    act(() => controller.openDevice('desktop-1'));

    act(() => {
      useUnifiedSpaceStore.setState({ devices: [], deviceTrustQuery: { kind: 'notApplicable' } });
    });

    expect(controller.selectedDevice).toBeNull();
    expect(controller.confirmingRemoval).toBe(false);
  });

  it('disables removal while another space operation is active', () => {
    mount(true);
    act(() => controller.openDevice('desktop-1'));
    act(() => {
      useUnifiedSpaceStore.setState({
        operationState: {
          kind: 'submitting',
          operation: {
            kind: 'leaveSpace',
            spaceId: 'space-1',
            targetDeviceId: null,
            localDeviceId: 'phone-1',
            beforeDevices: [],
          },
        },
      });
    });

    expect(controller.canRemoveSelected).toBe(false);
  });

  it('fails closed for high-impact actions when current relationships cannot be verified', () => {
    mount(true);
    act(() => {
      useUnifiedSpaceStore.setState({
        deviceTrustQuery: {
          kind: 'failed',
          failure: {
            operation: 'queryDeviceTrust',
            code: 1393,
            category: 'workspace_convergence_failed',
            retryable: true,
          },
        },
      });
    });

    expect(
      (controller as unknown as { highImpactActionsAvailable?: boolean }).highImpactActionsAvailable
    ).toBe(false);
  });
});
