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
  createInitialUnifiedSpaceSnapshot,
  useUnifiedSpaceStore,
  type UnifiedSpaceSnapshot,
} from '@/features/space/store';
import type { DeviceTrustSnapshot } from '@/platform/engine';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockCreateSpace = jest.fn();
const mockJoinSpace = jest.fn();
const mockCancelJoin = jest.fn();
const mockIssueInvitation = jest.fn();
const mockUnifiedSpaceUserErrorCode = jest.fn();

jest.mock('@/features/space', () => ({
  ...jest.requireActual('@/features/space/store'),
  getUnifiedSpaceService: () => ({
    createSpace: mockCreateSpace,
    joinSpace: mockJoinSpace,
    cancelJoin: mockCancelJoin,
    issueInvitation: mockIssueInvitation,
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
  invitationCode: '001-234',
  expiresAtMs: Date.now() + 60_000,
  availability: 'crossNetwork' as const,
};

const readyTrust = {
  revision: 1,
  localDeviceId: 'phone-1',
  localMembership: 'active',
  currentChange: null,
  devices: [],
  recovery: 'notAvailableInThisVersion',
  allowedActions: [],
  blockedReason: null,
  updatedAtMs: 1,
} satisfies DeviceTrustSnapshot;

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
    useUnifiedSpaceStore.setState(createInitialUnifiedSpaceSnapshot(), true);
    mockIssueInvitation.mockResolvedValue(invitation);
    mockCreateSpace.mockResolvedValue({ spaceId: 'space-1', invitation });
    mockJoinSpace.mockResolvedValue({ spaceId: 'space-1' });
    mockCancelJoin.mockResolvedValue(undefined);
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

    act(() => currentFlow.actions.updateInvitationCode('001234'));
    act(() => currentFlow.actions.continueFromCode());
    act(() => currentFlow.actions.setDeviceName('  Laptop  '));
    act(() => currentFlow.actions.setPassphrase('secret'));

    await act(async () => currentFlow.actions.submitJoin());

    expect(mockJoinSpace).toHaveBeenCalledTimes(1);
    expect(mockJoinSpace).toHaveBeenCalledWith('001-234', '  Laptop  ', 'secret', false);
    expect(currentFlow.state.mode).toBe('success');

    await act(async () => currentFlow.actions.completeConnection());
    expect(props.resetNativeFields).toHaveBeenCalledWith('Phone');
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps a slow join pending, blocks repeated taps and back, then shows success', async () => {
    jest.useFakeTimers();
    try {
      createHarness('join');
      act(() => currentFlow.actions.updateInvitationCode('001234'));
      act(() => currentFlow.actions.continueFromCode());
      act(() => currentFlow.actions.setPassphrase('secret'));
      let resolve!: (value: { spaceId: string }) => void;
      mockJoinSpace.mockReturnValue(
        new Promise((done) => {
          resolve = done;
        })
      );
      let submission!: Promise<void>;
      act(() => {
        submission = currentFlow.actions.submitJoin();
        void currentFlow.actions.submitJoin();
      });
      expect(mockJoinSpace).toHaveBeenCalledTimes(1);
      act(() => currentFlow.actions.back());
      expect(currentFlow.state.mode).toBe('joinDetails');
      await act(async () => {
        await jest.advanceTimersByTimeAsync(15_000);
      });
      expect(currentFlow.state).toMatchObject({
        pending: true,
        error: null,
        joinTakingLonger: true,
      });
      await act(async () => {
        resolve({ spaceId: 'space-1' });
        await submission;
      });
      expect(currentFlow.state).toMatchObject({ pending: false, error: null, mode: 'success' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('requests cancellation once and closes only after it is confirmed', async () => {
    const props = createHarness('join');
    act(() => currentFlow.actions.updateInvitationCode('001234'));
    act(() => currentFlow.actions.continueFromCode());
    act(() => currentFlow.actions.setPassphrase('secret'));
    let reject!: (error: Error) => void;
    mockJoinSpace.mockReturnValue(
      new Promise((_resolve, fail) => {
        reject = fail;
      })
    );
    let submission!: Promise<void>;
    act(() => {
      submission = currentFlow.actions.submitJoin();
    });
    await act(async () => {
      await currentFlow.actions.cancelJoin();
      await currentFlow.actions.cancelJoin();
    });
    expect(mockCancelJoin).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(currentFlow.state).toMatchObject({ pending: true, cancellingJoin: true });
    mockUnifiedSpaceUserErrorCode.mockReturnValue('joinCancelled');
    await act(async () => {
      reject(new Error('joinCancelled'));
      await submission;
    });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(currentFlow.state).toMatchObject({ pending: false, error: null });
  });

  it('keeps waiting after a failed cancellation and clears its warning on success', async () => {
    const props = createHarness('join');
    act(() => currentFlow.actions.updateInvitationCode('001234'));
    act(() => currentFlow.actions.continueFromCode());
    act(() => currentFlow.actions.setPassphrase('secret'));
    let resolve!: (value: { spaceId: string }) => void;
    mockJoinSpace.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    mockCancelJoin.mockRejectedValueOnce(new Error('unavailable'));
    let submission!: Promise<void>;
    act(() => {
      submission = currentFlow.actions.submitJoin();
    });
    await act(async () => {
      await currentFlow.actions.cancelJoin();
    });
    expect(currentFlow.state).toMatchObject({
      pending: true,
      cancellingJoin: false,
      error: 'space.join.cancelFailed',
    });
    await act(async () => {
      await currentFlow.actions.cancelJoin();
    });
    expect(mockCancelJoin).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolve({ spaceId: 'space-1' });
      await submission;
    });
    expect(props.onClose).not.toHaveBeenCalled();
    expect(currentFlow.state).toMatchObject({
      mode: 'success',
      pending: false,
      cancellingJoin: false,
      error: null,
    });
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

    act(() => currentFlow.actions.updateInvitationCode('001234'));
    act(() => currentFlow.actions.continueFromCode());
    act(() => currentFlow.actions.setPassphrase('secret'));

    await act(async () => currentFlow.actions.submitJoin());

    expect(mockJoinSpace).toHaveBeenNthCalledWith(1, '001-234', 'Phone', 'secret', false);
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

    expect(mockJoinSpace).toHaveBeenNthCalledWith(2, '001-234', 'Phone', 'secret', true);
    expect(currentFlow.state.mode).toBe('success');
    alert.mockRestore();
  });

  it('requires confirmation before replacing the active space', async () => {
    useUnifiedSpaceStore.setState({
      ...createInitialUnifiedSpaceSnapshot('ready'),
      spaceId: 'space-1',
      deviceTrustQuery: { kind: 'ready', snapshot: readyTrust },
    });
    createHarness('switch');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    expect(currentFlow.state.mode).toBe('joinCode');
    act(() => currentFlow.actions.updateInvitationCode('001234'));
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

    expect(mockJoinSpace).toHaveBeenCalledWith('001-234', 'Phone', 'secret', false);
    expect(currentFlow.state.mode).toBe('success');
    alert.mockRestore();
  });

  it('does not replace the active space when relationships become unverifiable before confirmation', async () => {
    useUnifiedSpaceStore.setState({
      ...createInitialUnifiedSpaceSnapshot('ready'),
      spaceId: 'space-1',
      deviceTrustQuery: { kind: 'ready', snapshot: readyTrust },
    });
    createHarness('switch');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    act(() => currentFlow.actions.updateInvitationCode('001234'));
    act(() => currentFlow.actions.continueFromCode());
    act(() => currentFlow.actions.setPassphrase('secret'));
    await act(async () => currentFlow.actions.submitJoin());

    const buttons = alert.mock.calls[0]?.[2];
    const confirmButton = buttons?.find((button) => button.text === 'space.switch.confirmAction');
    act(() => {
      useUnifiedSpaceStore.setState({
        deviceTrustQuery: {
          kind: 'failed',
          failure: {
            operation: 'queryDeviceTrust',
            code: 1393,
            category: 'invalidState',
            retryable: false,
          },
        },
      });
    });
    await act(async () => confirmButton?.onPress?.());

    expect(mockJoinSpace).not.toHaveBeenCalled();
    expect(currentFlow.state.error).toBe('space.error.operationFailed');
    alert.mockRestore();
  });

  it('owns invitation creation, renewal, copy, and share behavior', async () => {
    createHarness('create');
    const renewedInvitation = { ...invitation, invitationCode: '987-654' };
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
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('987-654');
    expect(currentFlow.state.copied).toBe(true);

    await act(async () => currentFlow.actions.shareInvitation());
    expect(shareSpy).toHaveBeenCalledWith({
      message: 'space.flow.shareMessage:987-654',
    });
    expect(Haptics.notificationAsync).toHaveBeenCalled();

    shareSpy.mockRestore();
  });

  it('moves a waiting creator to success when the unified list gains another device', async () => {
    createHarness('create');

    act(() => currentFlow.actions.setDeviceName('Phone'));
    act(() => currentFlow.actions.setPassphrase('secret'));
    await act(async () => currentFlow.actions.submitCreate());
    expect(currentFlow.state.mode).toBe('invitation');

    await act(async () => {
      useUnifiedSpaceStore.setState(
        {
          devices: [
            { deviceId: 'local', displayName: 'Phone', isLocal: true, online: true },
            { deviceId: 'remote', displayName: 'Laptop', isLocal: false, online: true },
          ],
        },
        true
      );
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
