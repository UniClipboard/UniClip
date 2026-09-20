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
  const operationGeneration = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

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
    const generation = ++operationGeneration.current;
    await saveQueue.current;
    const current = await load();
    if (generation === operationGeneration.current) {
      setRelays(current);
      setInitialRefreshFailed(false);
    }
    return current;
  }, [load]);

  useEffect(() => {
    let active = true;
    const generation = 0;
    setInitialRefreshFailed(false);
    void load()
      .then((current) => {
        if (!active || generation !== operationGeneration.current) return undefined;
        setRelays(current);
        return undefined;
      })
      .catch(() => {
        if (active && generation === operationGeneration.current) setInitialRefreshFailed(true);
      });
    return () => {
      active = false;
    };
  }, [load]);

  const save = useCallback(
    (input: Parameters<typeof saveCustomRelay>[0]): Promise<RelaySaveOutcome> => {
      const generation = ++operationGeneration.current;
      const run = async (): Promise<RelaySaveOutcome> => {
        try {
          const result = await saveCustomRelay(input);
          if (generation === operationGeneration.current) setRelays(result.relays);
          return result;
        } catch (error) {
          if (generation === operationGeneration.current) {
            const current = await load().catch(() => undefined);
            if (current && generation === operationGeneration.current) setRelays(current);
          }
          throw error;
        }
      };
      const queued = saveQueue.current.then(run, run);
      saveQueue.current = queued.then(
        () => undefined,
        () => undefined
      );
      return queued;
    },
    [load]
  );

  return { relays, refresh, save, initialRefreshFailed };
}
