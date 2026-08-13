import React from 'react';
import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { useMySpaceSheet } from '@/components/useMySpaceSheet';
import { useUnifiedSpaceStore, type UnifiedSpaceSnapshot } from '@/features/space/store';
import type { DeviceTrustSnapshot } from '@/platform/engine';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockIssueInvitation = jest.fn();
const mockRefresh = jest.fn();
const mockUnifiedSpaceUserErrorCode = jest.fn();

jest.mock('@/features/space', () => ({
  ...jest.requireActual('@/features/space/store'),
  getUnifiedSpaceService: () => ({
    issueInvitation: mockIssueInvitation,
    refresh: mockRefresh,
  }),
  unifiedSpaceUserErrorCode: (cause: unknown) => mockUnifiedSpaceUserErrorCode(cause),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { code?: string }) =>
      options?.code ? `${key}:${options.code}` : key,
  }),
}));

let invitation = {
  invitationCode: 'ABCD-1234',
  expiresAtMs: Date.now() + 61_000,
  availability: 'crossNetwork' as const,
};

const initialSnapshot: UnifiedSpaceSnapshot = {
  status: 'ready',
  spaceId: 'space-1',
  deviceName: 'Phone',
  invitation: null,
  devices: [
    { deviceId: 'local', displayName: 'Phone', isLocal: true, online: true },
    { deviceId: 'existing', displayName: 'Desktop', isLocal: false, online: true },
  ],
  lastError: null,
  hasResolvedDeviceList: true,
  deviceListRefreshStatus: 'idle',
};

const trustSnapshot: DeviceTrustSnapshot = {
  revision: 3,
  localDeviceId: 'local',
  localMembership: 'active',
  currentChange: null,
  devices: [
    {
      deviceId: 'local',
      displayName: 'Phone',
      isLocal: true,
      reachability: 'online',
      membership: 'active',
      groupRelationship: 'sameGroup',
      compatibility: 'compatible',
      syncRelationship: 'usable',
      availableActions: [],
      blockedReason: null,
    },
    {
      deviceId: 'existing',
      displayName: 'Desktop',
      isLocal: false,
      reachability: 'online',
      membership: 'active',
      groupRelationship: 'sameGroup',
      compatibility: 'compatible',
      syncRelationship: 'usable',
      availableActions: [],
      blockedReason: null,
    },
    {
      deviceId: 'diverged',
      displayName: 'Tablet',
      isLocal: false,
      reachability: 'online',
      membership: 'active',
      groupRelationship: 'differentGroup',
      compatibility: 'compatible',
      syncRelationship: 'pausedGroupDiverged',
      availableActions: [],
      blockedReason: null,
    },
  ],
  recovery: 'notAvailableInThisVersion',
  allowedActions: [],
  blockedReason: null,
  updatedAtMs: 10,
};

type MySpaceSheetState = ReturnType<typeof useMySpaceSheet>;

let currentSheet!: MySpaceSheetState;
let activeRenderer: ReactTestRenderer | null = null;

function Harness({
  visible = true,
  issueOnOpen = false,
}: {
  visible?: boolean;
  issueOnOpen?: boolean;
}) {
  currentSheet = useMySpaceSheet(visible, { issueOnOpen });
  return null;
}

function createHarness() {
  act(() => {
    activeRenderer = TestRenderer.create(<Harness />);
  });
}

describe('My Space sheet invitation flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useUnifiedSpaceStore.setState(initialSnapshot, true);
    mockRefresh.mockResolvedValue(initialSnapshot);
    invitation = {
      invitationCode: 'ABCD-1234',
      expiresAtMs: Date.now() + 61_000,
      availability: 'crossNetwork',
    };
    mockIssueInvitation.mockResolvedValue(invitation);
    mockUnifiedSpaceUserErrorCode.mockReturnValue(null);
  });

  afterEach(() => {
    if (activeRenderer) act(() => activeRenderer?.unmount());
    activeRenderer = null;
  });

  it('creates, copies, shares, and expires an invitation without closing the sheet', async () => {
    createHarness();
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });

    await act(async () => currentSheet.issueInvitation());

    expect(mockIssueInvitation).toHaveBeenCalledTimes(1);
    expect(currentSheet.invitation).toEqual(invitation);
    expect(currentSheet.invitationPending).toBe(false);
    expect(currentSheet.invitationExpired).toBe(false);
    expect(currentSheet.invitationTimeRemaining).toMatch(/^\d+:\d{2}$/);
    expect(currentSheet.invitationTimeRemaining).not.toBe('0:00');

    await act(async () => currentSheet.copyInvitation());
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('ABCD-1234');
    expect(currentSheet.invitationCopied).toBe(true);

    await act(async () => currentSheet.shareInvitation());
    expect(shareSpy).toHaveBeenCalledWith({
      message: 'space.flow.shareMessage:ABCD-1234',
    });

    mockIssueInvitation.mockResolvedValueOnce({
      ...invitation,
      invitationCode: 'WXYZ-9876',
      expiresAtMs: Date.now() - 1,
    });
    await act(async () => currentSheet.issueInvitation());
    expect(currentSheet.invitationExpired).toBe(true);

    shareSpy.mockRestore();
  });

  it('creates only one invitation when the add action is pressed repeatedly', async () => {
    let resolveInvitation!: (value: typeof invitation) => void;
    mockIssueInvitation.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveInvitation = resolve;
      })
    );
    createHarness();

    let firstRequest!: Promise<void>;
    let secondRequest!: Promise<void>;
    act(() => {
      firstRequest = currentSheet.issueInvitation();
      secondRequest = currentSheet.issueInvitation();
    });

    expect(mockIssueInvitation).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveInvitation(invitation);
      await Promise.all([firstRequest, secondRequest]);
    });
  });

  it('creates one invitation automatically each time a focused invitation sheet opens', async () => {
    await act(async () => {
      activeRenderer = TestRenderer.create(<Harness issueOnOpen />);
      await Promise.resolve();
    });

    expect(mockIssueInvitation).toHaveBeenCalledTimes(1);

    await act(async () => {
      activeRenderer?.update(<Harness issueOnOpen />);
      await Promise.resolve();
    });
    expect(mockIssueInvitation).toHaveBeenCalledTimes(1);

    act(() => activeRenderer?.update(<Harness visible={false} issueOnOpen />));
    await act(async () => {
      activeRenderer?.update(<Harness issueOnOpen />);
      await Promise.resolve();
    });
    expect(mockIssueInvitation).toHaveBeenCalledTimes(2);
  });

  it('reports the newly paired device after the unified device list changes', async () => {
    createHarness();
    await act(async () => currentSheet.issueInvitation());

    await act(async () => {
      useUnifiedSpaceStore.setState(
        {
          devices: [
            ...initialSnapshot.devices,
            { deviceId: 'new', displayName: 'New iPhone', isLocal: false, online: true },
          ],
        },
        true
      );
      await Promise.resolve();
    });

    expect(currentSheet.pairedDeviceName).toBe('New iPhone');
    expect(currentSheet.invitation).toBeNull();
  });

  it('keeps the sheet usable and exposes a localized error when invitation creation fails', async () => {
    createHarness();
    mockIssueInvitation.mockRejectedValueOnce(new Error('service unavailable'));
    mockUnifiedSpaceUserErrorCode.mockReturnValueOnce('serviceUnavailable');

    await act(async () => currentSheet.issueInvitation());

    expect(currentSheet.invitation).toBeNull();
    expect(currentSheet.invitationPending).toBe(false);
    expect(currentSheet.invitationError).toBe('space.error.serviceUnavailable');
  });

  it('clears transient invitation state after the sheet is dismissed', async () => {
    createHarness();
    await act(async () => currentSheet.issueInvitation());
    expect(currentSheet.invitation).toEqual(invitation);

    act(() => activeRenderer?.update(<Harness visible={false} />));

    expect(currentSheet.invitation).toBeNull();
    expect(currentSheet.pairedDeviceName).toBeNull();
    expect(currentSheet.invitationError).toBeNull();
  });
});

describe('My Space sheet device list state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRefresh.mockResolvedValue(initialSnapshot);
  });

  afterEach(() => {
    if (activeRenderer) act(() => activeRenderer?.unmount());
    activeRenderer = null;
  });

  it('does not call any refresh method when the sheet opens, closes, or reopens', async () => {
    createHarness();
    await act(async () => {
      activeRenderer?.update(<Harness visible={false} />);
      await Promise.resolve();
    });
    await act(async () => {
      activeRenderer?.update(<Harness />);
      await Promise.resolve();
    });
    await act(async () => {
      activeRenderer?.update(<Harness visible={false} />);
      await Promise.resolve();
    });

    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('derives the first-load state before any device list has resolved', () => {
    useUnifiedSpaceStore.setState(
      { ...initialSnapshot, hasResolvedDeviceList: false, devices: [] },
      true
    );
    createHarness();

    expect(currentSheet.isInitialLoading).toBe(true);
    expect(currentSheet.isInitialFailed).toBe(false);
    expect(currentSheet.isKnownEmpty).toBe(false);
    expect(currentSheet.deviceListFailed).toBe(false);
  });

  it('distinguishes a first-load failure from a known-list failure', () => {
    useUnifiedSpaceStore.setState(
      { ...initialSnapshot, hasResolvedDeviceList: false, status: 'failed', devices: [] },
      true
    );
    createHarness();
    expect(currentSheet.isInitialLoading).toBe(false);
    expect(currentSheet.isInitialFailed).toBe(true);
    expect(currentSheet.deviceListFailed).toBe(false);

    act(() => {
      useUnifiedSpaceStore.setState(
        { ...initialSnapshot, deviceListRefreshStatus: 'failed' },
        true
      );
    });
    expect(currentSheet.isInitialFailed).toBe(false);
    expect(currentSheet.deviceListFailed).toBe(true);
  });

  it('keeps returning device rows while a known list refreshes', () => {
    useUnifiedSpaceStore.setState(
      { ...initialSnapshot, deviceListRefreshStatus: 'refreshing' },
      true
    );
    createHarness();

    expect(currentSheet.isInitialLoading).toBe(false);
    expect(currentSheet.devices.length).toBe(2);
  });

  it('keeps Engine-known devices visible and prioritizes their trust relationship', () => {
    useUnifiedSpaceStore.setState({ ...initialSnapshot, deviceTrust: trustSnapshot }, true);
    createHarness();

    expect(currentSheet.devices).toHaveLength(3);
    expect(currentSheet.devices.find((device) => device.deviceId === 'diverged')).toMatchObject({
      displayName: 'Tablet',
      reachability: 'online',
      primaryStatus: 'differentSpace',
    });
  });

  it('does not mistake a known empty list for first load', () => {
    useUnifiedSpaceStore.setState(
      { ...initialSnapshot, devices: [], hasResolvedDeviceList: true },
      true
    );
    createHarness();

    expect(currentSheet.isKnownEmpty).toBe(true);
    expect(currentSheet.isInitialLoading).toBe(false);
  });

  it('does not show first load forever when the core confirms there is no space', () => {
    useUnifiedSpaceStore.setState(
      {
        ...initialSnapshot,
        status: 'empty',
        spaceId: null,
        hasResolvedDeviceList: false,
        devices: [],
      },
      true
    );
    createHarness();

    expect(currentSheet.isInitialLoading).toBe(false);
    expect(currentSheet.isKnownEmpty).toBe(true);
    expect(currentSheet.isInitialFailed).toBe(false);
  });

  it('calls the full refresh for pull and retry and keeps the progress until it truly ends', async () => {
    let resolveRefresh!: (value: UnifiedSpaceSnapshot) => void;
    mockRefresh.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      })
    );
    createHarness();

    let pull!: Promise<void>;
    act(() => {
      pull = currentSheet.refresh();
    });
    expect(currentSheet.isUserRefreshing).toBe(true);

    await act(async () => {
      resolveRefresh(initialSnapshot);
      await pull;
    });
    expect(currentSheet.isUserRefreshing).toBe(false);
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    await act(async () => currentSheet.refresh());
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });

  it('allows refreshing again after a user-initiated refresh fails', async () => {
    mockRefresh
      .mockRejectedValueOnce(new Error('Engine error 1383'))
      .mockResolvedValueOnce(initialSnapshot);
    createHarness();

    await act(async () => currentSheet.refresh());
    expect(currentSheet.isUserRefreshing).toBe(false);

    await act(async () => currentSheet.refresh());
    expect(currentSheet.isUserRefreshing).toBe(false);
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });
});
