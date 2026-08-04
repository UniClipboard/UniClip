import React from 'react';
import { Alert, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import {
  useAddSyncConnectionFlow,
  type AddSyncConnectionFlow,
} from '@/components/useAddSyncConnectionFlow';
import {
  createInitialUnifiedEngineSnapshot,
  useUnifiedEngineStore,
} from '@/stores/unifiedEngineStore';
import {
  createInitialUnifiedSpaceSnapshot,
  useUnifiedSpaceStore,
  type UnifiedSpaceSnapshot,
} from '@/features/space/store';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockCreateSpace = jest.fn();
const mockJoinSpace = jest.fn();
const mockIssueInvitation = jest.fn();
const mockRefresh = jest.fn();
const mockUnifiedSpaceUserErrorCode = jest.fn();

jest.mock('@/features/space', () => ({
  ...jest.requireActual('@/features/space/store'),
  getUnifiedSpaceService: () => ({
    createSpace: mockCreateSpace,
    joinSpace: mockJoinSpace,
    issueInvitation: mockIssueInvitation,
    refresh: mockRefresh,
  }),
  unifiedSpaceUserErrorCode: (cause: unknown) => mockUnifiedSpaceUserErrorCode(cause),
}));

jest.mock('expo-haptics', () => ({
  NotificationFeedbackType: { Success: 'success' },
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { code?: string }) =>
      options?.code ? `${key}:${options.code}` : key,
  }),
}));

const invitation = {
  invitationCode: 'ABCD-1234',
  expiresAtMs: Date.now() + 60_000,
  availability: 'crossNetwork' as const,
};

const remoteSnapshot: UnifiedSpaceSnapshot = {
  status: 'ready',
  spaceId: 'space-1',
  deviceName: 'Phone',
  invitation,
  devices: [
    { deviceId: 'local', displayName: 'Phone', isLocal: true, online: true },
    { deviceId: 'remote', displayName: 'Laptop', isLocal: false, online: true },
  ],
  lastError: null,
};

interface HarnessProps {
  initialMode?: 'choose' | 'create' | 'join' | 'switch';
  onClose: jest.Mock;
  onConnected: jest.Mock;
  resetNativeFields: jest.Mock;
  clearNativePassphrase: jest.Mock;
}

let currentFlow!: AddSyncConnectionFlow;
let activeRenderer: ReactTestRenderer | null = null;

function Harness(props: HarnessProps) {
  currentFlow = useAddSyncConnectionFlow({
    visible: true,
    initialMode: props.initialMode,
    defaultDeviceName: 'Phone',
    onClose: props.onClose,
    onConnected: props.onConnected,
    resetNativeFields: props.resetNativeFields,
    clearNativePassphrase: props.clearNativePassphrase,
  });
  return null;
}

function createHarness(initialMode?: HarnessProps['initialMode']) {
  const props: HarnessProps = {
    initialMode,
    onClose: jest.fn(),
    onConnected: jest.fn(async () => true),
    resetNativeFields: jest.fn(),
    clearNativePassphrase: jest.fn(),
  };
  act(() => {
    activeRenderer = TestRenderer.create(<Harness {...props} />);
  });

  return props;
}

describe('add sync connection flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useUnifiedEngineStore.setState(createInitialUnifiedEngineSnapshot(), true);
    useUnifiedSpaceStore.setState(createInitialUnifiedSpaceSnapshot(), true);
    mockRefresh.mockResolvedValue(createInitialUnifiedSpaceSnapshot('ready'));
    mockIssueInvitation.mockResolvedValue(invitation);
    mockCreateSpace.mockResolvedValue({ spaceId: 'space-1', invitation });
    mockJoinSpace.mockResolvedValue({ spaceId: 'space-1' });
    mockUnifiedSpaceUserErrorCode.mockReturnValue(null);
  });

  afterEach(() => {
    if (!activeRenderer) return;
    act(() => activeRenderer?.unmount());
    activeRenderer = null;
  });

  it('owns the staged join flow and submits normalized inputs once', async () => {
    const props = createHarness('join');

    expect(currentFlow.state.mode).toBe('joinCode');

    act(() => currentFlow.actions.updateInvitationCode('ab12'));
    act(() => currentFlow.actions.continueFromCode());
    expect(currentFlow.state.error).toBe('space.error.invitationCodeInvalid');

    act(() => currentFlow.actions.updateInvitationCode('ab12cd34'));
    act(() => currentFlow.actions.continueFromCode());
    act(() => currentFlow.actions.setDeviceName('  Laptop  '));
    act(() => currentFlow.actions.setPassphrase('secret'));

    await act(async () => currentFlow.actions.submitJoin());

    expect(mockJoinSpace).toHaveBeenCalledTimes(1);
    expect(mockJoinSpace).toHaveBeenCalledWith('AB12-CD34', '  Laptop  ', 'secret', false);
    expect(currentFlow.state.mode).toBe('success');

    await act(async () => currentFlow.actions.completeConnection());
    expect(props.resetNativeFields).toHaveBeenCalledWith('Phone');
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('requires confirmation before preserving unreadable history and retrying', async () => {
    createHarness('join');
    const confirmationError = new Error('engine 1292');
    mockJoinSpace.mockRejectedValueOnce(confirmationError).mockResolvedValueOnce({
      spaceId: 'space-2',
      preservedUnreadableRecords: 1,
    });
    mockUnifiedSpaceUserErrorCode.mockReturnValueOnce('unreadableHistoryRequiresConfirmation');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    act(() => currentFlow.actions.updateInvitationCode('ab12cd34'));
    act(() => currentFlow.actions.continueFromCode());
    act(() => currentFlow.actions.setPassphrase('secret'));

    await act(async () => currentFlow.actions.submitJoin());

    expect(mockJoinSpace).toHaveBeenNthCalledWith(1, 'AB12-CD34', 'Phone', 'secret', false);
    expect(alert).toHaveBeenCalledWith(
      'space.unreadableHistory.title',
      'space.unreadableHistory.body',
      expect.any(Array)
    );
    expect(currentFlow.state.mode).toBe('joinDetails');

    const buttons = alert.mock.calls[0]?.[2];
    const continueButton = buttons?.find(
      (button) => button.text === 'space.unreadableHistory.continue'
    );
    await act(async () => continueButton?.onPress?.());

    expect(mockJoinSpace).toHaveBeenNthCalledWith(2, 'AB12-CD34', 'Phone', 'secret', true);
    expect(currentFlow.state.mode).toBe('success');
    alert.mockRestore();
  });

  it('requires confirmation before replacing the active space', async () => {
    createHarness('switch');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    expect(currentFlow.state.mode).toBe('joinCode');
    act(() => currentFlow.actions.updateInvitationCode('ab12cd34'));
    act(() => currentFlow.actions.continueFromCode());
    act(() => currentFlow.actions.setPassphrase('secret'));

    await act(async () => currentFlow.actions.submitJoin());

    expect(mockJoinSpace).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(
      'space.switch.confirmTitle',
      'space.switch.confirm',
      expect.any(Array)
    );

    const buttons = alert.mock.calls[0]?.[2];
    const confirmButton = buttons?.find((button) => button.text === 'space.switch.confirmAction');
    await act(async () => confirmButton?.onPress?.());

    expect(mockJoinSpace).toHaveBeenCalledWith('AB12-CD34', 'Phone', 'secret', false);
    expect(currentFlow.state.mode).toBe('success');
    alert.mockRestore();
  });

  it('owns invitation creation, renewal, copy, and share behavior', async () => {
    createHarness('create');
    const renewedInvitation = { ...invitation, invitationCode: 'WXYZ-9876' };
    mockIssueInvitation.mockResolvedValueOnce(renewedInvitation);
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });

    act(() => currentFlow.actions.setDeviceName('Phone'));
    act(() => currentFlow.actions.setPassphrase('secret'));
    await act(async () => currentFlow.actions.submitCreate());

    expect(mockCreateSpace).toHaveBeenCalledWith('Phone', 'secret');
    expect(currentFlow.state.mode).toBe('invitation');
    expect(currentFlow.state.invitation).toEqual(invitation);

    await act(async () => currentFlow.actions.renewInvitation());
    expect(currentFlow.state.invitation).toEqual(renewedInvitation);

    await act(async () => currentFlow.actions.copyInvitation());
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('WXYZ-9876');
    expect(currentFlow.state.copied).toBe(true);

    await act(async () => currentFlow.actions.shareInvitation());
    expect(shareSpy).toHaveBeenCalledWith({
      message: 'space.flow.shareMessage:WXYZ-9876',
    });
    expect(Haptics.notificationAsync).toHaveBeenCalled();

    shareSpy.mockRestore();
  });

  it('moves a waiting creator to success when refresh discovers another device', async () => {
    createHarness('create');
    mockRefresh.mockResolvedValueOnce(createInitialUnifiedSpaceSnapshot('ready'));
    mockRefresh.mockImplementationOnce(async () => {
      useUnifiedSpaceStore.setState(remoteSnapshot, true);
      return remoteSnapshot;
    });

    act(() => currentFlow.actions.setDeviceName('Phone'));
    act(() => currentFlow.actions.setPassphrase('secret'));
    await act(async () => currentFlow.actions.submitCreate());
    expect(currentFlow.state.mode).toBe('invitation');

    await act(async () => {
      useUnifiedEngineStore.setState({ refreshRevision: 1 });
      await Promise.resolve();
    });

    expect(currentFlow.state.mode).toBe('success');
    expect(currentFlow.state.remoteDeviceName).toBe('Laptop');
  });

  it('keeps the sheet open when the caller rejects completion', async () => {
    const props = createHarness('create');
    props.onConnected.mockResolvedValueOnce(false);

    await act(async () => currentFlow.actions.completeConnection());

    expect(props.resetNativeFields).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('maps service failures without leaving the flow pending', async () => {
    createHarness('create');
    mockCreateSpace.mockRejectedValueOnce(new Error('engine 1233'));
    mockUnifiedSpaceUserErrorCode.mockReturnValueOnce('passphraseMismatch');

    act(() => currentFlow.actions.setPassphrase('wrong'));
    await act(async () => currentFlow.actions.submitCreate());

    expect(currentFlow.state.mode).toBe('create');
    expect(currentFlow.state.pending).toBe(false);
    expect(currentFlow.state.error).toBe('space.error.passphraseMismatch');
  });
});
