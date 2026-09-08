import { useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/features/settings';
import {
  getLanServerService,
  type LanConnectIntent,
  type LanServerProfile,
  probeLanServers,
} from '@/features/lan-servers';
import { connectLanFromQr } from '@/features/lan-servers/connectFromQr';
import { scanLanConnection } from '@/features/lan-servers/scanLanConnection';

export function useOnboardingConnection() {
  const { t } = useTranslation('settingsSync');
  const [stage, setStage] = useState<'intro' | 'confirm' | 'success'>('intro');
  const [intent, setIntent] = useState<LanConnectIntent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  const saved = useRef<LanServerProfile | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const scan = async () => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = await scanLanConnection(t('action.cancel', { ns: 'common' }), t('lan.qr.hint'));
      if (!mounted.current) return;
      saved.current = null;
      setIntent(next);
      setStage(next ? 'confirm' : 'intro');
    } catch {
      if (!mounted.current) return;
      setIntent(null);
      setStage('intro');
      setError(t('pairing.scanFailed', { ns: 'onboarding' }));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const connect = async () => {
    if (!intent || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!saved.current) {
        saved.current = await connectLanFromQr(intent, {
          probe: probeLanServers,
          save: (...args) => {
            if (!mounted.current) throw new Error('Cancelled');
            return getLanServerService().save(...args);
          },
        });
      }
      await useSettingsStore.getState().loadConfig();
      if (useSettingsStore.getState().error) throw new Error('SaveFailed');
      if (mounted.current) setStage('success');
    } catch (cause) {
      if (!mounted.current) return;
      const code = cause instanceof Error ? cause.message : '';
      setError(
        code === 'AuthFailed'
          ? t('lan.probe.authFailed')
          : code === 'Unreachable'
          ? t('lan.probe.allUnreachable')
          : t('pairing.saveFailed', { ns: 'onboarding' })
      );
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const close = () => {
    if (locked.current) return;
    setStage('intro');
    setIntent(null);
    setError(null);
    saved.current = null;
  };

  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (locked.current) return true;
      if (stage === 'confirm') {
        void scan();
        return true;
      }
      if (stage === 'success') {
        close();
        return true;
      }
      return false;
    });
    return () => listener.remove();
  });

  return { stage, intent, busy, error, scan, connect, close };
}
