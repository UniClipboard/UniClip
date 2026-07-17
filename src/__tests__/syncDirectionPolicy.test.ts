import { describe, expect, it } from '@jest/globals';
import {
  canAutoApplyInBackground,
  canAutoPushInBackground,
  shouldRunBackgroundSync,
} from '../utils/syncDirectionPolicy';

const backgroundCapabilities = {
  enableBackgroundTasks: true,
  enableBackgroundDownload: true,
  enableBackgroundUpload: true,
};

describe('sync direction policy', () => {
  it('requires auto-write consent for background apply', () => {
    expect(canAutoApplyInBackground({ ...backgroundCapabilities, autoApplyRemote: false })).toBe(
      false
    );
    expect(canAutoApplyInBackground({ ...backgroundCapabilities, autoApplyRemote: true })).toBe(
      true
    );
  });

  it('requires auto-push consent for background upload', () => {
    expect(canAutoPushInBackground({ ...backgroundCapabilities, autoPushLocal: false })).toBe(
      false
    );
    expect(canAutoPushInBackground({ ...backgroundCapabilities, autoPushLocal: true })).toBe(true);
  });

  it('blocks both background directions while tasks are temporarily disabled', () => {
    expect(
      canAutoApplyInBackground({ ...backgroundCapabilities, autoApplyRemote: true }, true)
    ).toBe(false);
    expect(canAutoPushInBackground({ ...backgroundCapabilities, autoPushLocal: true }, true)).toBe(
      false
    );
  });

  it('requires the matching background capability', () => {
    expect(
      canAutoApplyInBackground({
        ...backgroundCapabilities,
        autoApplyRemote: true,
        enableBackgroundDownload: false,
      })
    ).toBe(false);
    expect(
      canAutoPushInBackground({
        ...backgroundCapabilities,
        autoPushLocal: true,
        enableBackgroundUpload: false,
      })
    ).toBe(false);
  });

  it('runs background services only for an enabled direction', () => {
    expect(
      shouldRunBackgroundSync(
        {
          ...backgroundCapabilities,
          autoApplyRemote: false,
          autoPushLocal: false,
        },
        false
      )
    ).toBe(false);
    expect(
      shouldRunBackgroundSync(
        {
          ...backgroundCapabilities,
          autoApplyRemote: true,
          autoPushLocal: false,
        },
        false
      )
    ).toBe(true);
    expect(
      shouldRunBackgroundSync(
        {
          ...backgroundCapabilities,
          autoApplyRemote: true,
          autoPushLocal: true,
        },
        true
      )
    ).toBe(false);
  });
});
