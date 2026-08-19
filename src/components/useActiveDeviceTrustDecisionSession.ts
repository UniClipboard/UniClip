import { useEffect } from 'react';

import {
  deviceTrustPreviewSession,
  useDeviceTrustPreviewSession,
} from '@/devtools/deviceTrustPreviewSession';
import { hasAuthoritativeDeviceTrustWork } from '@/devtools/deviceTrustPreviewCoordinator';
import { useUnifiedSpaceStore } from '@/features/space/store';
import type { DeviceTrustDecisionSession } from './DeviceTrustDecisionSession';
import { useDeviceTrustDecision } from './useDeviceTrustDecision';

export function useActiveDeviceTrustDecisionSession(): DeviceTrustDecisionSession {
  const liveSession = useDeviceTrustDecision();
  const previewSession = useDeviceTrustPreviewSession();
  const authoritative = useUnifiedSpaceStore(hasAuthoritativeDeviceTrustWork);

  useEffect(() => {
    if (authoritative && previewSession) deviceTrustPreviewSession.close();
  }, [authoritative, previewSession]);

  return authoritative ? liveSession : previewSession ?? liveSession;
}
