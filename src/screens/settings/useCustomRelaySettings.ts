import { useCallback, useEffect, useRef, useState } from 'react';

import {
  refreshCustomRelays,
  saveCustomRelay,
  type CustomRelay,
  type RelaySaveOutcome,
} from '@/features/relaySettings';
import { useSettingsStore } from '@/stores';

export function useCustomRelaySettings() {
  const legacyUrls = useSettingsStore((state) => state.config?.customRelayUrls ?? []);
  const initialLegacyUrls = useRef(legacyUrls).current;
  const updateConfig = useSettingsStore((state) => state.updateConfig);
  const [relays, setRelays] = useState<CustomRelay[]>([]);
  const [initialRefreshFailed, setInitialRefreshFailed] = useState(false);
  const pendingLegacyUrls = useRef(initialLegacyUrls).current;
  const migrationPending = useRef(pendingLegacyUrls.length > 0);

  const load = useCallback(async (): Promise<CustomRelay[]> => {
    const legacyUrlsToMigrate = migrationPending.current ? pendingLegacyUrls : [];
    const current = await refreshCustomRelays(legacyUrlsToMigrate);
    if (legacyUrlsToMigrate.length > 0) {
      await updateConfig({ customRelayUrls: [] });
      migrationPending.current = false;
    }
    return current;
  }, [pendingLegacyUrls, updateConfig]);

  const refresh = useCallback(async (): Promise<CustomRelay[]> => {
    const current = await load();
    setRelays(current);
    setInitialRefreshFailed(false);
    return current;
  }, [load]);

  useEffect(() => {
    let active = true;
    setInitialRefreshFailed(false);
    void load()
      .then((current) => {
        if (!active) return undefined;
        setRelays(current);
        return undefined;
      })
      .catch(() => {
        if (active) setInitialRefreshFailed(true);
      });
    return () => {
      active = false;
    };
  }, [load]);

  const save = useCallback(
    async (input: Parameters<typeof saveCustomRelay>[0]): Promise<RelaySaveOutcome> => {
      try {
        const result = await saveCustomRelay(input);
        setRelays(result.relays);
        return result;
      } catch (error) {
        await refresh().catch(() => undefined);
        throw error;
      }
    },
    [refresh]
  );

  return { relays, refresh, save, initialRefreshFailed };
}
