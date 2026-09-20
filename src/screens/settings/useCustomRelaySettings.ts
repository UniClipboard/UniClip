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

  const refresh = useCallback(async (): Promise<CustomRelay[]> => {
    const current = await refreshCustomRelays();
    setRelays(current);
    return current;
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const current = await refreshCustomRelays(initialLegacyUrls);
        setRelays(current);
        if (initialLegacyUrls.length > 0) await updateConfig({ customRelayUrls: [] });
      } catch {
        setInitialRefreshFailed(true);
      }
    })();
  }, [initialLegacyUrls, updateConfig]);

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
