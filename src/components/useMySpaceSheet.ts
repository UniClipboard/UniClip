import { useCallback, useEffect, useRef, useState } from 'react';
import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { InvitationIssued } from 'uc-engine';
import { useTranslation } from 'react-i18next';

import { getUnifiedSpaceService, unifiedSpaceUserErrorCode } from '@/services/UnifiedSpaceService';
import { useUnifiedEngineStore } from '@/stores/unifiedEngineStore';
import { useUnifiedSpaceStore } from '@/stores/unifiedSpaceStore';

function remainingTime(expiresAtMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

export function useMySpaceSheet(visible: boolean, options?: { issueOnOpen?: boolean }) {
  const { t } = useTranslation('settingsSync');
  const devices = useUnifiedSpaceStore((state) => state.devices);
  const spaceId = useUnifiedSpaceStore((state) => state.spaceId);
  const spaceStatus = useUnifiedSpaceStore((state) => state.status);
  const refreshRevision = useUnifiedEngineStore((state) => state.refreshRevision);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [invitation, setInvitation] = useState<InvitationIssued | null>(null);
  const [invitationPending, setInvitationPending] = useState(false);
  const [invitationError, setInvitationError] = useState<string | null>(null);
  const [invitationCopied, setInvitationCopied] = useState(false);
  const [pairedDeviceName, setPairedDeviceName] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const invitationPendingRef = useRef(false);
  const issuedOnOpenRef = useRef(false);
  const awaitingPairingRef = useRef(false);
  const deviceIdsBeforeInvitationRef = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!spaceId) return;

    setRefreshing(true);
    setRefreshFailed(false);
    try {
      await getUnifiedSpaceService().refreshDevices();
    } catch {
      setRefreshFailed(true);
    } finally {
      setRefreshing(false);
    }
  }, [spaceId]);

  useEffect(() => {
    if (!visible) return;
    void refresh();
  }, [refresh, refreshRevision, visible]);

  useEffect(() => {
    if (!visible) {
      invitationPendingRef.current = false;
      issuedOnOpenRef.current = false;
      awaitingPairingRef.current = false;
      setInvitation(null);
      setInvitationPending(false);
      setInvitationError(null);
      setInvitationCopied(false);
      setPairedDeviceName(null);
      return;
    }

    if (!invitation) return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [invitation, visible]);

  useEffect(() => {
    if (!visible || !invitation || !awaitingPairingRef.current) return;
    const pairedDevice = devices.find(
      (device) => !device.isLocal && !deviceIdsBeforeInvitationRef.current.has(device.deviceId)
    );
    if (!pairedDevice) return;

    awaitingPairingRef.current = false;
    setInvitation(null);
    setInvitationCopied(false);
    setPairedDeviceName(pairedDevice.displayName);
  }, [devices, invitation, visible]);

  const issueInvitation = useCallback(async () => {
    if (invitationPendingRef.current) return;
    invitationPendingRef.current = true;
    deviceIdsBeforeInvitationRef.current = new Set(devices.map((device) => device.deviceId));
    setInvitationPending(true);
    setInvitationError(null);
    setInvitationCopied(false);
    setPairedDeviceName(null);
    try {
      const issued = await getUnifiedSpaceService().issueInvitation();
      setInvitation(issued);
      setNowMs(Date.now());
      awaitingPairingRef.current = true;
    } catch (cause) {
      const code = unifiedSpaceUserErrorCode(cause);
      setInvitationError(code ? t(`space.error.${code}`) : t('space.error.operationFailed'));
    } finally {
      invitationPendingRef.current = false;
      setInvitationPending(false);
    }
  }, [devices, t]);

  useEffect(() => {
    if (!visible || !options?.issueOnOpen || issuedOnOpenRef.current) return;
    issuedOnOpenRef.current = true;
    void issueInvitation();
  }, [issueInvitation, options?.issueOnOpen, visible]);

  const copyInvitation = async () => {
    if (!invitation) return;
    await Clipboard.setStringAsync(invitation.invitationCode);
    setInvitationCopied(true);
  };

  const shareInvitation = async () => {
    if (!invitation) return;
    await Share.share({
      message: t('space.flow.shareMessage', { code: invitation.invitationCode }),
    });
  };

  const invitationExpired = invitation ? invitation.expiresAtMs <= nowMs : false;

  return {
    devices,
    isLoading:
      devices.length === 0 && (refreshing || spaceStatus === 'idle' || spaceStatus === 'loading'),
    refreshFailed,
    refresh,
    invitation,
    invitationPending,
    invitationError,
    invitationCopied,
    invitationExpired,
    invitationTimeRemaining: invitation ? remainingTime(invitation.expiresAtMs, nowMs) : '0:00',
    pairedDeviceName,
    issueInvitation,
    copyInvitation,
    shareInvitation,
  };
}
