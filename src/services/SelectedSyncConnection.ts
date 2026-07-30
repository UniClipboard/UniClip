import type { PeerConnectionStatus, UnifiedEngineStatus } from '@/stores/unifiedEngineStore';
import type { SyncChannel } from '@/types/settings';
import type { ConnectionStatus } from '@/utils/connectionStatus';

export function deriveP2pConnectionStatus(
  status: UnifiedEngineStatus,
  peerStatus: PeerConnectionStatus,
  hasSpace: boolean
): ConnectionStatus {
  if (!hasSpace) return 'unconfigured';

  switch (status) {
    case 'running':
      return peerStatus === 'online'
        ? 'online'
        : peerStatus === 'offline'
        ? 'offline'
        : 'connecting';
    case 'starting':
    case 'quiescing':
    case 'quiesced':
      return 'connecting';
    case 'failed':
      return 'error';
    case 'suspended':
    case 'shuttingDown':
    case 'stopped':
      return 'offline';
  }
}

export async function refreshSelectedConnection(
  channel: SyncChannel,
  refresh: { refreshP2p(): Promise<unknown>; refreshLan(): Promise<unknown> }
): Promise<void> {
  if (channel === 'p2p') {
    await refresh.refreshP2p();
    return;
  }
  await refresh.refreshLan();
}
