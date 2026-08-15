import { useCallback } from 'react';

import { getUnifiedSpaceService, useUnifiedSpaceStore } from '@/features/space';

export function useSpaceOperationResult() {
  const operationState = useUnifiedSpaceStore((state) => state.operationState);
  const result = operationState.kind === 'result' ? operationState.result : null;
  const finish = useCallback(() => getUnifiedSpaceService().clearOperationResult(), []);
  return { result, finish };
}
