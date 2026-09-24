import { useEffect, useRef, useState } from 'react';
import { Alert, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import type { DeviceTrustSnapshot, InvitationIssued } from '@/platform/engine';
import { useTranslation } from 'react-i18next';

import {
  getUnifiedSpaceService,
  unifiedSpaceUserErrorCode,
} from '@/features/space';
import { useUnifiedSpaceStore } from '@/features/space';
import { useUnifiedEngineStore } from '@/stores/unifiedEngineStore';
import {
  formatInvitationCode,
  invitationCodeInputValue,
  isInvitationCodeComplete,
} from '@/utils/invitationCode';
import type { AddSyncConnectionMode } from './AddSyncConnectionSheet.types';

export type AddSyncConnectionFlowMode =
  | 'choose'
  | 'create'
  | 'joinCode'
  | 'joinDetails'
  | 'invitation'
  | 'joinUpdating'
  | 'joinReady'
  | 'success';

interface UseAddSyncConnectionFlowOptions {
  visible: boolean;
  initialMode?: AddSyncConnectionMode;
  defaultDeviceName: string;
  onClose: () => void;
  onConnected?: () => boolean | Promise<boolean>;
  resetNativeFields: (defaultDeviceName: string) => void;
  clearNativePassphrase: () => void;
}

export interface AddSyncConnectionFlowState {
  mode: AddSyncConnectionFlowMode;
  deviceName: string;
  passphrase: string;
  invitationCode: string;
  invitation: InvitationIssued | null;
  pending: boolean;
  joinSubmitted: boolean;
  restoredJoin: boolean;
  joinTakingLonger: boolean;
  cancellingJoin: boolean;
  error: string | null;
  copied: boolean;
  canSubmitDetails: boolean;
  codeComplete: boolean;
  invitationExpired: boolean;
  invitationTimeRemaining: string;
  remoteDeviceName: string | null;
  peerUpgradeRequired: boolean;
  deviceUpdate: DeviceTrustSnapshot['spaceDeviceUpdate'];
  removalAcknowledgementPending: boolean;
}

export interface AddSyncConnectionFlowActions {
  setDeviceName: (value: string) => void;
  setPassphrase: (value: string) => void;
  updateInvitationCode: (value: string) => void;
  continueFromCode: () => void;
  selectMode: (mode: 'create' | 'joinCode') => void;
  back: () => void;
  close: () => void;
  submitCreate: () => Promise<void>;
  submitJoin: () => Promise<void>;
  editJoinDetails: () => void;
  cancelJoin: () => Promise<void>;
  renewInvitation: () => Promise<void>;
  copyInvitation: () => Promise<void>;
  shareInvitation: () => Promise<void>;
  completeConnection: () => Promise<void>;
}

export interface AddSyncConnectionFlow {
  state: AddSyncConnectionFlowState;
  actions: AddSyncConnectionFlowActions;
}

function modeFromInitial(
  initialMode: AddSyncConnectionMode
): AddSyncConnectionFlowMode {
  return initialMode === 'join' || initialMode === 'switch'
    ? 'joinCode'
    : initialMode;
}

const DEFAULT_DEVICE_UPDATE: DeviceTrustSnapshot['spaceDeviceUpdate'] = {
  phase: 'updating',
  reason: null,
  recovery: null,
  nextRetryAtMs: null,
};

function currentJoinCompletionMode(): 'joinUpdating' | 'joinReady' {
  const query = useUnifiedSpaceStore.getState().deviceTrustQuery;
  return query.kind === 'ready' &&
    query.snapshot.spaceDeviceUpdate.phase === 'completed'
    ? 'joinReady'
    : 'joinUpdating';
}

function remainingTime(expiresAtMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function canReplaceCurrentSpace(): boolean {
  const state = useUnifiedSpaceStore.getState();
  return (
    state.deviceTrustQuery.kind === 'ready' &&
    state.deviceTrustQuery.snapshot.currentChange === null &&
    !state.deviceTrustQuery.snapshot.groupChoices?.issues.length &&
    state.operationState.kind === 'idle'
  );
}

export function useAddSyncConnectionFlow({
  visible,
  initialMode = 'choose',
  defaultDeviceName,
  onClose,
  onConnected,
  resetNativeFields,
  clearNativePassphrase,
}: UseAddSyncConnectionFlowOptions): AddSyncConnectionFlow {
  const { t } = useTranslation('settingsSync');
  const [mode, setMode] = useState<AddSyncConnectionFlowMode>(() =>
    modeFromInitial(initialMode)
  );
  const [deviceName, setDeviceName] = useState(defaultDeviceName);
  const [passphrase, setPassphrase] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [invitation, setInvitation] = useState<InvitationIssued | null>(null);
  const [pending, setPending] = useState(false);
  const [joinSubmitted, setJoinSubmitted] = useState(false);
  const [restoredJoin, setRestoredJoin] = useState(false);
  const pendingRef = useRef(false);
  const [joinTakingLonger, setJoinTakingLonger] = useState(false);
  const [cancellingJoin, setCancellingJoin] = useState(false);
  const cancellingJoinRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [peerUpgradeRequired, setPeerUpgradeRequired] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const mountedRef = useRef(true);
  const engineStarted = useUnifiedEngineStore((state) => state.isStarted);
  const spaceStatus = useUnifiedSpaceStore((state) => state.status);
  const deviceUpdate = useUnifiedSpaceStore((state) =>
    state.deviceTrustQuery.kind === 'ready'
      ? state.deviceTrustQuery.snapshot.spaceDeviceUpdate
      : DEFAULT_DEVICE_UPDATE
  );
  const removalAcknowledgementPending = useUnifiedSpaceStore((state) =>
    state.deviceTrustQuery.kind === 'ready' &&
    state.deviceTrustQuery.snapshot.devices.some(
      (device) => device.groupRelationship === 'awaitingRemovalAcknowledgement'
    )
  );
  const confirmedAtInvitation = useRef<Set<string>>(new Set());
  const pendingInvitationDevice = useRef<string | null>(null);
  const resumeAttempted = useRef(false);
  const remoteDeviceName = useUnifiedSpaceStore((state) => {
    const query = state.deviceTrustQuery;
    if (query.kind !== 'ready') return null;
    const pendingId = query.snapshot.pendingInboundMember?.deviceId;
    if (pendingId) pendingInvitationDevice.current = pendingId;
    return (
      query.snapshot.devices.find(
        (device) =>
          !device.isLocal &&
          device.membership === 'active' &&
          device.pairingConfirmation === 'confirmed' &&
          (!confirmedAtInvitation.current.has(device.deviceId) ||
            device.deviceId === pendingInvitationDevice.current)
      )?.displayName ?? null
    );
  });

  const errorMessage = (cause: unknown): string => {
    const code = unifiedSpaceUserErrorCode(cause);
    return code ? t(`space.error.${code}`) : t('space.error.operationFailed');
  };

  const reset = () => {
    resetNativeFields(defaultDeviceName);
    setMode(modeFromInitial(initialMode));
    setDeviceName(defaultDeviceName);
    setPassphrase('');
    setInvitationCode('');
    setInvitation(null);
    setError(null);
    setJoinSubmitted(false);
    setRestoredJoin(false);
    setCopied(false);
    setPeerUpgradeRequired(false);
  };

  useEffect(() => {
    if (!pending || mode !== 'joinDetails') {
      setJoinTakingLonger(false);
      return;
    }
    const timer = setTimeout(() => setJoinTakingLonger(true), 15_000);
    return () => clearTimeout(timer);
  }, [mode, pending]);

  useEffect(() => {
    if (visible) setMode(modeFromInitial(initialMode));
  }, [initialMode, visible]);

  useEffect(() => {
    if (!visible || initialMode !== 'join' || spaceStatus !== 'ready') return;
    const query = useUnifiedSpaceStore.getState().deviceTrustQuery;
    if (query.kind !== 'ready' || query.snapshot.currentJoin?.type !== 'active')
      return;
    setMode(
      query.snapshot.spaceDeviceUpdate.phase === 'completed'
        ? 'joinReady'
        : 'joinUpdating'
    );
  }, [initialMode, spaceStatus, visible]);

  useEffect(() => {
    if (mode !== 'joinUpdating' && mode !== 'joinReady') return;
    const nextMode =
      deviceUpdate.phase === 'completed' ? 'joinReady' : 'joinUpdating';
    if (nextMode === mode) return;
    setMode(nextMode);
    if (nextMode === 'joinReady') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [deviceUpdate.phase, mode]);

  useEffect(() => {
    if (!visible || mode !== 'joinUpdating' || !engineStarted) return;
    void getUnifiedSpaceService().refreshDeviceTrust();
    const timer = setInterval(() => {
      void getUnifiedSpaceService().refreshDeviceTrust();
    }, 3000);
    return () => clearInterval(timer);
  }, [engineStarted, mode, visible]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!visible || mode !== 'invitation') return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [mode, visible]);

  useEffect(() => {
    if (!visible || mode !== 'invitation') return;
    if (!remoteDeviceName) return;
    setMode('success');
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [mode, remoteDeviceName, visible]);

  useEffect(() => {
    if (!visible || mode !== 'invitation' || !engineStarted) return;
    void getUnifiedSpaceService().refreshDeviceTrust();
    const timer = setInterval(() => {
      void getUnifiedSpaceService().refreshDeviceTrust();
    }, 3000);
    return () => clearInterval(timer);
  }, [engineStarted, mode, visible]);

  useEffect(() => {
    if (
      !visible ||
      initialMode !== 'join' ||
      mode !== 'joinCode' ||
      !engineStarted ||
      spaceStatus !== 'empty' ||
      pendingRef.current ||
      resumeAttempted.current
    )
      return;
    resumeAttempted.current = true;
    void getUnifiedSpaceService()
      .resumeJoin(() => {
        if (!mountedRef.current) return;
        pendingRef.current = true;
        setPending(true);
        setJoinSubmitted(true);
        setRestoredJoin(true);
        setMode('joinDetails');
      })
      .then((joined) => {
        if (!mountedRef.current || !joined) return;
        setPeerUpgradeRequired(joined.peerUpgradeRequired === true);
        setMode(currentJoinCompletionMode());
      })
      .catch((cause: unknown) => {
        if (!mountedRef.current) return;
        if (unifiedSpaceUserErrorCode(cause) === 'joinCancelled') {
          reset();
          onClose();
          return;
        }
        setRestoredJoin(false);
        setMode('joinCode');
        setError(errorMessage(cause));
      })
      .finally(() => {
        if (!mountedRef.current) return;
        pendingRef.current = false;
        setPending(false);
      });
  }, [engineStarted, initialMode, mode, spaceStatus, visible]);

  const completeConnection = async () => {
    if ((await onConnected?.()) === false) return;
    if (!mountedRef.current) return;
    reset();
    onClose();
  };

  const close = () => {
    if (pendingRef.current) return;
    if (mode === 'joinUpdating') {
      reset();
      onClose();
      return;
    }
    if (mode === 'invitation' || mode === 'success' || mode === 'joinReady') {
      void completeConnection();
      return;
    }
    reset();
    onClose();
  };

  const back = () => {
    if (pendingRef.current) return;
    setError(null);
    if (mode === 'joinDetails') {
      setMode('joinCode');
      return;
    }
    if (initialMode === 'choose') {
      setMode('choose');
      return;
    }
    close();
  };

  const selectMode = (nextMode: 'create' | 'joinCode') => {
    setError(null);
    setPassphrase('');
    clearNativePassphrase();
    setMode(nextMode);
  };

  const updateInvitationCode = (value: string) => {
    const nextValue = invitationCodeInputValue(value);
    setInvitationCode(nextValue);
    setError(
      /^[0-9]{0,6}$/.test(nextValue)
        ? null
        : t('space.error.invitationCodeInvalid')
    );
    if (nextValue.length === 3 || isInvitationCodeComplete(nextValue))
      void Haptics.selectionAsync();
  };

  const continueFromCode = () => {
    if (!isInvitationCodeComplete(invitationCode)) {
      setError(t('space.error.invitationCodeInvalid'));
      return;
    }
    setError(null);
    setJoinSubmitted(false);
    setMode('joinDetails');
  };

  const editJoinDetails = () => {
    if (pendingRef.current) return;
    setJoinSubmitted(false);
    setRestoredJoin(false);
    setError(null);
    setPassphrase('');
    clearNativePassphrase();
    setMode('joinDetails');
  };

  const submitCreate = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const created = await getUnifiedSpaceService().createSpace(
        deviceName,
        passphrase
      );
      const query = useUnifiedSpaceStore.getState().deviceTrustQuery;
      confirmedAtInvitation.current = new Set(
        query.kind === 'ready'
          ? query.snapshot.devices
              .filter((device) => device.pairingConfirmation === 'confirmed')
              .map((device) => device.deviceId)
          : []
      );
      pendingInvitationDevice.current = null;
      setInvitation(created.invitation);
      setNowMs(Date.now());
      setMode('invitation');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const joinWithCurrentInputs = async () => {
    if (pendingRef.current) return;
    if (initialMode === 'switch' && !canReplaceCurrentSpace()) {
      setError(t('space.error.operationFailed'));
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setJoinSubmitted(true);
    setError(null);
    try {
      const joined = await getUnifiedSpaceService().joinSpace(
        formatInvitationCode(invitationCode),
        deviceName,
        passphrase,
        false
      );
      if (!mountedRef.current) return;
      setError(null);
      setPeerUpgradeRequired(joined.peerUpgradeRequired === true);
      setMode(currentJoinCompletionMode());
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (cause) {
      if (!mountedRef.current) return;
      const code = unifiedSpaceUserErrorCode(cause);
      if (code === 'joinCancelled') {
        reset();
        onClose();
        return;
      }
      if (code === 'unreadableHistoryRequiresConfirmation') {
        Alert.alert(
          t('space.unreadableHistory.title'),
          t('space.unreadableHistory.body'),
          [
            {
              text: t('action.cancel', { ns: 'common' }),
              style: 'cancel',
              onPress: editJoinDetails,
            },
            {
              text: t('space.unreadableHistory.continue'),
              style: 'destructive',
              onPress: () => {
                if (pendingRef.current || !mountedRef.current) return;
                pendingRef.current = true;
                setPending(true);
                setError(null);
                void getUnifiedSpaceService()
                  .joinSpace(
                    formatInvitationCode(invitationCode),
                    deviceName,
                    passphrase,
                    true
                  )
                  .then((joined) => {
                    if (!mountedRef.current) return;
                    setError(null);
                    setPeerUpgradeRequired(joined.peerUpgradeRequired === true);
                    setMode(currentJoinCompletionMode());
                    void Haptics.notificationAsync(
                      Haptics.NotificationFeedbackType.Success
                    );
                  })
                  .catch((retryCause) => {
                    if (!mountedRef.current) return;
                    const retryCode = unifiedSpaceUserErrorCode(retryCause);
                    if (retryCode === 'joinCancelled') {
                      reset();
                      onClose();
                      return;
                    }
                    setError(
                      retryCode === 'unreadableHistoryRequiresConfirmation'
                        ? t('space.error.operationFailed')
                        : errorMessage(retryCause)
                    );
                  })
                  .finally(() => {
                    pendingRef.current = false;
                    cancellingJoinRef.current = false;
                    if (mountedRef.current) setCancellingJoin(false);
                    if (mountedRef.current) setPending(false);
                  });
              },
            },
          ]
        );
        return;
      }
      setError(
        code ? t(`space.error.${code}`) : t('space.error.operationFailed')
      );
    } finally {
      pendingRef.current = false;
      cancellingJoinRef.current = false;
      if (mountedRef.current) setCancellingJoin(false);
      if (mountedRef.current) setPending(false);
    }
  };

  const cancelJoin = async () => {
    if (!pendingRef.current || cancellingJoinRef.current) return;
    cancellingJoinRef.current = true;
    setCancellingJoin(true);
    setError(null);
    try {
      await getUnifiedSpaceService().cancelJoin();
    } catch {
      if (!mountedRef.current || !pendingRef.current) return;
      cancellingJoinRef.current = false;
      setCancellingJoin(false);
      setError(t('space.join.cancelFailed'));
    }
  };

  const submitJoin = async () => {
    if (pendingRef.current) return;
    if (initialMode === 'switch') {
      Alert.alert(t('space.switch.confirmTitle'), t('space.switch.confirm'), [
        {
          text: t('action.cancel', { ns: 'common' }),
          style: 'cancel',
        },
        {
          text: t('space.switch.confirmAction'),
          style: 'destructive',
          onPress: () => {
            void joinWithCurrentInputs();
          },
        },
      ]);
      return;
    }
    await joinWithCurrentInputs();
  };

  const renewInvitation = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const query = useUnifiedSpaceStore.getState().deviceTrustQuery;
      confirmedAtInvitation.current = new Set(
        query.kind === 'ready'
          ? query.snapshot.devices
              .filter((device) => device.pairingConfirmation === 'confirmed')
              .map((device) => device.deviceId)
          : []
      );
      pendingInvitationDevice.current = null;
      setInvitation(await getUnifiedSpaceService().issueInvitation());
      setNowMs(Date.now());
      setCopied(false);
      setPeerUpgradeRequired(false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const copyInvitation = async () => {
    if (!invitation) return;
    await Clipboard.setStringAsync(invitation.invitationCode);
    setCopied(true);
    void Haptics.selectionAsync();
  };

  const shareInvitation = async () => {
    if (!invitation) return;
    await Share.share({
      message: t('space.flow.shareMessage', {
        code: invitation.invitationCode,
      }),
    });
  };

  return {
    state: {
      mode,
      deviceName,
      passphrase,
      invitationCode,
      invitation,
      pending,
      joinSubmitted,
      restoredJoin,
      joinTakingLonger,
      cancellingJoin,
      error,
      copied,
      canSubmitDetails:
        deviceName.trim().length > 0 && passphrase.trim().length > 0,
      codeComplete: isInvitationCodeComplete(invitationCode),
      invitationExpired: invitation ? invitation.expiresAtMs <= nowMs : false,
          invitationTimeRemaining: invitation
            ? remainingTime(invitation.expiresAtMs, nowMs)
            : '0:00',
          remoteDeviceName,
          peerUpgradeRequired,
          deviceUpdate,
          removalAcknowledgementPending,
    },
    actions: {
      setDeviceName,
      setPassphrase,
      updateInvitationCode,
      continueFromCode,
      selectMode,
      back,
      close,
      submitCreate,
      submitJoin,
      editJoinDetails,
      cancelJoin,
      renewInvitation,
      copyInvitation,
      shareInvitation,
      completeConnection,
    },
  };
}
