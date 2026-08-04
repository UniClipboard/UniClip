import React from 'react';
import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { useMySpaceSheet } from '@/components/useMySpaceSheet';
import {
  createInitialUnifiedEngineSnapshot,
  useUnifiedEngineStore,
} from '@/stores/unifiedEngineStore';
import { useUnifiedSpaceStore, type UnifiedSpaceSnapshot } from '@/features/space/store';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockIssueInvitation = jest.fn();
const mockRefreshDevices = jest.fn();
const mockUnifiedSpaceUserErrorCode = jest.fn();

jest.mock('@/features/space', () => ({
  ...jest.requireActual('@/features/space/store'),
  getUnifiedSpaceService: () => ({
    issueInvitation: mockIssueInvitation,
    refreshDevices: mockRefreshDevices,
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
    useUnifiedEngineStore.setState(createInitialUnifiedEngineSnapshot(), true);
    useUnifiedSpaceStore.setState(initialSnapshot, true);
    mockRefreshDevices.mockResolvedValue(initialSnapshot);
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

  it('reports the newly paired device after the engine refreshes the device list', async () => {
    createHarness();
    await act(async () => currentSheet.issueInvitation());

    const pairedSnapshot: UnifiedSpaceSnapshot = {
      ...initialSnapshot,
      devices: [
        ...initialSnapshot.devices,
        { deviceId: 'new', displayName: 'New iPhone', isLocal: false, online: true },
      ],
    };
    mockRefreshDevices.mockImplementationOnce(async () => {
      useUnifiedSpaceStore.setState(pairedSnapshot, true);
      return pairedSnapshot;
    });

    await act(async () => {
      useUnifiedEngineStore.setState({ refreshRevision: 1 });
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
