import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import type { AddSyncConnectionFlow } from '@/components/useAddSyncConnectionFlow';
import {
  ADD_SYNC_CONNECTION_PREVIEW_SCENARIOS,
  createAddSyncConnectionPreviewState,
  useAddSyncConnectionPreviewFlow,
} from '@/devtools/useAddSyncConnectionPreviewFlow';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let currentFlow: AddSyncConnectionFlow;

function Harness({ scenario, onClose }: {
  scenario: Parameters<typeof useAddSyncConnectionPreviewFlow>[0];
  onClose: () => void;
}) {
  currentFlow = useAddSyncConnectionPreviewFlow(scenario, onClose);
  return null;
}

describe('pairing sheet preview', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = null;
  });

  it('maps every listed scenario to a real product sheet mode', () => {
    const modes = ADD_SYNC_CONNECTION_PREVIEW_SCENARIOS.map(({ id }) =>
      createAddSyncConnectionPreviewState(id, 'failed').mode
    );

    expect(modes).toHaveLength(15);
    expect(modes).toEqual(
      expect.arrayContaining(['joinDetails', 'joinUpdating', 'joinReady', 'invitation', 'success'])
    );
  });

  it('covers automatic retry and all Engine attention reasons', () => {
    expect(createAddSyncConnectionPreviewState('deviceRetrying', '').deviceUpdate.phase).toBe(
      'retryableFailure'
    );
    for (const reason of [
      'deviceStateRejected',
      'deviceRelationshipConflict',
      'deviceSecurityUpdateRejected',
      'deviceUpgradeRequired',
    ] as const) {
      const state = createAddSyncConnectionPreviewState(reason, '');
      expect(state.deviceUpdate).toMatchObject({ phase: 'needsAttention', reason });
    }
  });

  it('keeps preview actions local and allows closing then reopening the same scenario', async () => {
    const onClose = jest.fn();
    act(() => {
      renderer = TestRenderer.create(<Harness scenario="inviterWaiting" onClose={onClose} />);
    });

    await act(async () => currentFlow.actions.copyInvitation());
    expect(currentFlow.state.copied).toBe(true);
    await act(async () => currentFlow.actions.shareInvitation());
    expect(onClose).not.toHaveBeenCalled();

    act(() => currentFlow.actions.close());
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => {
      renderer?.unmount();
      renderer = TestRenderer.create(<Harness scenario="inviterWaiting" onClose={onClose} />);
    });
    expect(currentFlow.state.mode).toBe('invitation');
    expect(currentFlow.state.copied).toBe(false);
  });

  it('shows cancellation only as the existing in-progress action state', async () => {
    const onClose = jest.fn();
    act(() => {
      renderer = TestRenderer.create(<Harness scenario="joinPending" onClose={onClose} />);
    });

    await act(async () => currentFlow.actions.cancelJoin());
    expect(currentFlow.state).toMatchObject({ mode: 'joinDetails', pending: true, cancellingJoin: true });
    expect(onClose).not.toHaveBeenCalled();
  });
});
