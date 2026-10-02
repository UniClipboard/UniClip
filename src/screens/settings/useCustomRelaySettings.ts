import { useCallback, useEffect, useRef, useState } from 'react';

import type { RelayOverview } from '@/features/relayOverview';
import {
  loadRelayOverview,
  refreshCustomRelays,
  saveCustomRelay,
  subscribeRelayChanges,
  type CustomRelay,
  type RelaySaveOutcome,
} from '@/features/relaySettings';
import { useSettingsStore } from '@/stores';

/** Engine may still be starting when the page opens; retry quietly before showing an error. */
export const OVERVIEW_RETRY_DELAYS_MS = [1000, 2000, 4000];

export type RelayOverviewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; value: RelayOverview };

export function useCustomRelaySettings() {
  const legacyUrls = useSettingsStore((state) => state.config?.customRelayUrls ?? []);
  const initialLegacyUrls = useRef(legacyUrls).current;
  const updateConfig = useSettingsStore((state) => state.updateConfig);
  const [relays, setRelays] = useState<CustomRelay[]>([]);
  const [initialRefreshFailed, setInitialRefreshFailed] = useState(false);
  const pendingLegacyUrls = useRef(initialLegacyUrls).current;
  const migrationPending = useRef(pendingLegacyUrls.length > 0);
  const operationGeneration = useRef(0);
  const [overview, setOverview] = useState<RelayOverviewState>({ status: 'loading' });
  const overviewGeneration = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  // Engine owns the overview; the latest read always wins and a failure is never shown as empty.
  const readOverview = useCallback(async (): Promise<void> => {
    const generation = ++overviewGeneration.current;
    for (let attempt = 0; ; attempt += 1) {
      try {
        const value = await loadRelayOverview();
        if (generation === overviewGeneration.current) setOverview({ status: 'ready', value });
        return;
      } catch {
        if (generation !== overviewGeneration.current) return;
        const delay = OVERVIEW_RETRY_DELAYS_MS[attempt];
        if (delay === undefined) {
          setOverview({ status: 'error' });
          return;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        if (generation !== overviewGeneration.current) return;
      }
    }
  }, []);


  const load = useCallback(async (): Promise<CustomRelay[]> => {
    const legacyUrlsToMigrate = migrationPending.current ? pendingLegacyUrls : [];
    const current = await refreshCustomRelays(legacyUrlsToMigrate);
    if (legacyUrlsToMigrate.length > 0) {
      await updateConfig({ customRelayUrls: [] });
      migrationPending.current = false;
    }
    return current;
  }, [pendingLegacyUrls, updateConfig]);

  const refreshCustom = useCallback(async (): Promise<CustomRelay[]> => {
    const generation = ++operationGeneration.current;
    await saveQueue.current;
    const current = await load();
    if (generation === operationGeneration.current) {
      setRelays(current);
      setInitialRefreshFailed(false);
    }
    return current;
  }, [load]);

  const refresh = useCallback((): Promise<CustomRelay[]> => {
    void readOverview();
    return refreshCustom();
  }, [readOverview, refreshCustom]);

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

  useEffect(() => {
    void readOverview();
  }, [readOverview]);

  // Another screen's save (or the rebuild that follows it) changes what Engine reports.
  useEffect(
    () =>
      subscribeRelayChanges(() => {
        void readOverview();
        void refreshCustom().catch(() => undefined);
      }),
    [readOverview, refreshCustom]
  );

  // Both reads can lose a race with Engine startup, so one retry re-reads the overview and the
  // custom list together.
  const retryOverview = useCallback(async (): Promise<void> => {
    setOverview({ status: 'loading' });
    await Promise.all([readOverview(), refreshCustom().catch(() => undefined)]);
  }, [readOverview, refreshCustom]);

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

  return { relays, refresh, save, initialRefreshFailed, overview, retryOverview };
}
