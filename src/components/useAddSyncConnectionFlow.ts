import { useEffect, useRef, useState } from 'react';
import { Alert, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import type { InvitationIssued } from '@/platform/engine';
import { useTranslation } from 'react-i18next';

import { getUnifiedSpaceService, unifiedSpaceUserErrorCode } from '@/features/space';
import { useUnifiedEngineStore } from '@/stores/unifiedEngineStore';
import { useUnifiedSpaceStore } from '@/features/space';
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

interface AddSyncConnectionFlowState {
  mode: AddSyncConnectionFlowMode;
  deviceName: string;
  passphrase: string;
  invitationCode: string;
  invitation: InvitationIssued | null;
  pending: boolean;
  error: string | null;
  copied: boolean;
  canSubmitDetails: boolean;
  codeComplete: boolean;
  invitationExpired: boolean;
  invitationTimeRemaining: string;
  remoteDeviceName: string | null;
}

interface AddSyncConnectionFlowActions {
  setDeviceName: (value: string) => void;
  setPassphrase: (value: string) => void;
  updateInvitationCode: (value: string) => void;
  continueFromCode: () => void;
  selectMode: (mode: 'create' | 'joinCode') => void;
  back: () => void;
  close: () => void;
  submitCreate: () => Promise<void>;
  submitJoin: () => Promise<void>;
  renewInvitation: () => Promise<void>;
  copyInvitation: () => Promise<void>;
  shareInvitation: () => Promise<void>;
  completeConnection: () => Promise<void>;
}

export interface AddSyncConnectionFlow {
  state: AddSyncConnectionFlowState;
  actions: AddSyncConnectionFlowActions;
}

function modeFromInitial(initialMode: AddSyncConnectionMode): AddSyncConnectionFlowMode {
  return initialMode === 'join' ? 'joinCode' : initialMode;
}

function remainingTime(expiresAtMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
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
  const [mode, setMode] = useState<AddSyncConnectionFlowMode>(() => modeFromInitial(initialMode));
  const [deviceName, setDeviceName] = useState(defaultDeviceName);
  const [passphrase, setPassphrase] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [invitation, setInvitation] = useState<InvitationIssued | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const mountedRef = useRef(true);
  const refreshRevision = useUnifiedEngineStore((state) => state.refreshRevision);
  const remoteDeviceName = useUnifiedSpaceStore(
    (state) => state.devices.find((device) => !device.isLocal)?.displayName ?? null
  );

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
    setCopied(false);
  };

  useEffect(() => {
    if (visible) setMode(modeFromInitial(initialMode));
  }, [initialMode, visible]);

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
    void getUnifiedSpaceService()
      .refresh()
      .then((snapshot) => {
        if (!mountedRef.current || !snapshot.devices.some((device) => !device.isLocal)) return;
        setMode('success');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      })
      .catch(() => undefined);
  }, [mode, refreshRevision, visible]);

  const completeConnection = async () => {
    if ((await onConnected?.()) === false) return;
    if (!mountedRef.current) return;
    reset();
    onClose();
  };

  const close = () => {
    if (pending) return;
    if (mode === 'invitation' || mode === 'success') {
      void completeConnection();
      return;
    }
    reset();
    onClose();
  };

  const back = () => {
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
    setError(null);
    if (nextValue.length === 4 || nextValue.length === 8) void Haptics.selectionAsync();
  };

  const continueFromCode = () => {
    if (!isInvitationCodeComplete(invitationCode)) {
      setError(t('space.error.invitationCodeInvalid'));
      return;
    }
    setError(null);
    setMode('joinDetails');
  };

  const submitCreate = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const created = await getUnifiedSpaceService().createSpace(deviceName, passphrase);
      setInvitation(created.invitation);
      setNowMs(Date.now());
      setMode('invitation');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  const submitJoin = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await getUnifiedSpaceService().joinSpace(
        formatInvitationCode(invitationCode),
        deviceName,
        passphrase,
        false
      );
      setMode('success');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (cause) {
      if (unifiedSpaceUserErrorCode(cause) === 'unreadableHistoryRequiresConfirmation') {
        Alert.alert(t('space.unreadableHistory.title'), t('space.unreadableHistory.body'), [
          {
            text: t('action.cancel', { ns: 'common' }),
            style: 'cancel',
          },
          {
            text: t('space.unreadableHistory.continue'),
            style: 'destructive',
            onPress: () => {
              setPending(true);
              setError(null);
              void getUnifiedSpaceService()
                .joinSpace(formatInvitationCode(invitationCode), deviceName, passphrase, true)
                .then(() => {
                  if (!mountedRef.current) return;
                  setMode('success');
                  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                })
                .catch((retryCause) => {
                  if (!mountedRef.current) return;
                  const retryCode = unifiedSpaceUserErrorCode(retryCause);
                  setError(
                    retryCode === 'unreadableHistoryRequiresConfirmation'
                      ? t('space.error.operationFailed')
                      : errorMessage(retryCause)
                  );
                })
                .finally(() => {
                  if (mountedRef.current) setPending(false);
                });
            },
          },
        ]);
        return;
      }
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  const renewInvitation = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      setInvitation(await getUnifiedSpaceService().issueInvitation());
      setNowMs(Date.now());
      setCopied(false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
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
      message: t('space.flow.shareMessage', { code: invitation.invitationCode }),
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
      error,
      copied,
      canSubmitDetails: deviceName.trim().length > 0 && passphrase.trim().length > 0,
      codeComplete: isInvitationCodeComplete(invitationCode),
      invitationExpired: invitation ? invitation.expiresAtMs <= nowMs : false,
      invitationTimeRemaining: invitation ? remainingTime(invitation.expiresAtMs, nowMs) : '0:00',
      remoteDeviceName,
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
      renewInvitation,
      copyInvitation,
      shareInvitation,
      completeConnection,
    },
  };
}
