import { useCallback, useEffect, useState } from 'react';

import { getUnifiedSpaceService } from '@/services/UnifiedSpaceService';
import { useUnifiedEngineStore } from '@/stores/unifiedEngineStore';
import { useUnifiedSpaceStore } from '@/stores/unifiedSpaceStore';

export function useMySpaceSheet(visible: boolean) {
  const devices = useUnifiedSpaceStore((state) => state.devices);
  const spaceId = useUnifiedSpaceStore((state) => state.spaceId);
  const spaceStatus = useUnifiedSpaceStore((state) => state.status);
  const refreshRevision = useUnifiedEngineStore((state) => state.refreshRevision);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);

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

  return {
    devices,
    isLoading:
      devices.length === 0 && (refreshing || spaceStatus === 'idle' || spaceStatus === 'loading'),
    refreshFailed,
    refresh,
  };
}
