jest.mock('app-group-store', () => ({ getKeyboardStatus: jest.fn() }));

import { deriveKeyboardStatus } from '../screens/settings/ios/useKeyboardStatus';

describe('iOS keyboard setup status', () => {
  it('does not trust a Full Access flag left without a heartbeat time', () => {
    // A keyboard without Full Access cannot write to the App Group, so turning
    // Full Access off never overwrites an old `true` (also migrated from older
    // builds). Only a timestamped heartbeat is evidence.
    const view = deriveKeyboardStatus({
      enabledInSystem: true,
      lastHeartbeatAtMs: null,
      lastKnownFullAccess: true,
    });
    expect(view.state).toBe('added');
    expect(view.fullAccessConfirmedAtMs).toBeNull();
  });

  it('is ready once a timestamped heartbeat confirmed Full Access', () => {
    const view = deriveKeyboardStatus({
      enabledInSystem: true,
      lastHeartbeatAtMs: 1_000,
      lastKnownFullAccess: true,
    });
    expect(view.state).toBe('ready');
    expect(view.fullAccessConfirmedAtMs).toBe(1_000);
  });

  it('follows the system keyboard list over an old heartbeat', () => {
    const view = deriveKeyboardStatus({
      enabledInSystem: false,
      lastHeartbeatAtMs: 1_000,
      lastKnownFullAccess: true,
    });
    expect(view.state).toBe('notAdded');
  });

  it('is unknown when the list is unreadable and no heartbeat landed', () => {
    const view = deriveKeyboardStatus({
      enabledInSystem: null,
      lastHeartbeatAtMs: null,
      lastKnownFullAccess: false,
    });
    expect(view.state).toBe('unknown');
    expect(view.added).toBe(false);
  });
});
