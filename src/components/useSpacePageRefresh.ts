import { useCallback, useEffect, useRef, useState } from 'react';
import { getUnifiedSpaceService } from '@/features/space';
import { useUnifiedEngineStore } from '@/stores/unifiedEngineStore';

export function useSpacePageRefresh() {
  const isStarted = useUnifiedEngineStore((state) => state.isStarted);
  const startupFailed = useUnifiedEngineStore((state) => state.status === 'failed');
  const startupError = useUnifiedEngineStore((state) => state.lastError);
  const [error, setError] = useState<unknown>(null);
  const requestRevision = useRef(0);

  const refresh = useCallback(async () => {
    const revision = ++requestRevision.current;
    setError(null);
    if (!useUnifiedEngineStore.getState().isStarted) return;
    try {
      await getUnifiedSpaceService().refresh();
    } catch (cause) {
      if (revision === requestRevision.current) setError(cause);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // A query from the previous engine session must not leave an error on this page.
    return () => {
      requestRevision.current += 1;
    };
  }, [isStarted, refresh]);

  return {
    refresh,
    waiting: !isStarted && !startupFailed,
    error: !isStarted && startupFailed ? new Error(startupError ?? 'Engine start failed') : error,
  };
}
