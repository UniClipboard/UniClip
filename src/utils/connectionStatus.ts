import type { PeerConnectionStatus, UnifiedEngineStatus } from '@/stores/unifiedEngineStore';

export type ConnectionStatus = 'unconfigured' | 'connecting' | 'online' | 'offline' | 'error';

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
