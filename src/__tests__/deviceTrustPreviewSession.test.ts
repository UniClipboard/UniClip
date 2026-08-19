import {
  DEVICE_TRUST_PREVIEW_SCENARIOS,
  deviceTrustPreviewSession,
} from '../devtools/deviceTrustPreviewSession';
import { createInitialUnifiedSpaceSnapshot, useUnifiedSpaceStore } from '../features/space/store';

describe('device trust preview session', () => {
  it('does not list the development phone as a device syncing with itself', () => {
    deviceTrustPreviewSession.open('standard');

    const choices = deviceTrustPreviewSession.getState().session?.view?.choices ?? [];
    for (const choice of choices) {
      expect(choice.continueSyncNames).not.toContain('This development phone');
      expect(choice.stopSyncNames).not.toContain('This development phone');
      expect(choice.requiresRejoinNames).not.toContain('This development phone');
    }
  });

  afterEach(() => deviceTrustPreviewSession.close());

  it('provides every ADR preview branch as a fixed scenario', () => {
    expect(DEVICE_TRUST_PREVIEW_SCENARIOS.map(({ id }) => id)).toEqual([
      'standard',
      'singleChoice',
      'confirmKeepCurrent',
      'confirmLeaveCurrent',
      'submitting',
      'failedRetry',
      'stateChanged',
      'longScrollable',
    ]);
  });

  it('uses platform-neutral sample device names on Android and iOS', () => {
    for (const { id } of DEVICE_TRUST_PREVIEW_SCENARIOS) {
      deviceTrustPreviewSession.open(id);
      const view = deviceTrustPreviewSession.getState().session?.view;
      const names = [
        view?.sourceName,
        ...(view?.targetNames ?? []),
        ...(view?.choices.flatMap((choice) => [
          ...choice.continueSyncNames,
          ...choice.stopSyncNames,
          ...choice.requiresRejoinNames,
        ]) ?? []),
      ];

      expect(names.join(' ')).not.toMatch(/android/i);
    }
  });

  it.each(DEVICE_TRUST_PREVIEW_SCENARIOS)('opens and closes $id without persistence', ({ id }) => {
    deviceTrustPreviewSession.open(id);

    expect(deviceTrustPreviewSession.getState().session?.view).not.toBeNull();

    deviceTrustPreviewSession.close();

    expect(deviceTrustPreviewSession.getState().session).toBeNull();
  });

  it('keeps high-impact choices behind confirmation and supports cancel', async () => {
    deviceTrustPreviewSession.open('confirmKeepCurrent');
    const choice = 'keepCurrentDeviceGroup';

    await deviceTrustPreviewSession.getState().session?.choose(choice);
    expect(deviceTrustPreviewSession.getState().session?.confirmingChoice).toBeNull();

    await deviceTrustPreviewSession.getState().session?.proceed();
    expect(deviceTrustPreviewSession.getState().session?.confirmingChoice).toBe(choice);

    deviceTrustPreviewSession.getState().session?.cancelConfirmation();
    expect(deviceTrustPreviewSession.getState().session?.confirmingChoice).toBeNull();
  });

  it('closes after a locally confirmed decision without a real callback', async () => {
    deviceTrustPreviewSession.open('confirmLeaveCurrent');
    const session = deviceTrustPreviewSession.getState().session;

    await session?.choose('applyChange');
    await deviceTrustPreviewSession.getState().session?.proceed();
    await deviceTrustPreviewSession.getState().session?.confirm();

    expect(deviceTrustPreviewSession.getState().session).toBeNull();
  });

  it('closes after a safe choice proceeds locally', async () => {
    deviceTrustPreviewSession.open('standard');

    await deviceTrustPreviewSession.getState().session?.choose('applyChange');
    await deviceTrustPreviewSession.getState().session?.proceed();

    expect(deviceTrustPreviewSession.getState().session).toBeNull();
  });

  it('requires confirmation when a preview choice stops syncing remote devices', async () => {
    deviceTrustPreviewSession.open('longScrollable');

    await deviceTrustPreviewSession.getState().session?.choose('applyChange');
    await deviceTrustPreviewSession.getState().session?.proceed();

    expect(deviceTrustPreviewSession.getState().session?.confirmingChoice).toBe('applyChange');
  });

  it('turns the failed scenario into a local retry without leaving the preview', async () => {
    deviceTrustPreviewSession.open('failedRetry');
    expect(deviceTrustPreviewSession.getState().session?.error).not.toBeNull();

    await deviceTrustPreviewSession.getState().session?.proceed();

    expect(deviceTrustPreviewSession.getState().session?.error).toBeNull();
    expect(deviceTrustPreviewSession.getState().session?.view).not.toBeNull();
  });

  it('resets selection and confirmation when another scenario opens', async () => {
    deviceTrustPreviewSession.open('confirmKeepCurrent');
    await deviceTrustPreviewSession.getState().session?.choose('keepCurrentDeviceGroup');

    deviceTrustPreviewSession.open('singleChoice');

    const session = deviceTrustPreviewSession.getState().session;
    expect(session?.confirmingChoice).toBeNull();
    expect(session?.selectedChoice).toBe('applyChange');
  });

  it('leaves authoritative space state untouched across every preview action', async () => {
    useUnifiedSpaceStore.setState(createInitialUnifiedSpaceSnapshot('ready'), true);
    const authoritativeBefore = useUnifiedSpaceStore.getState();

    for (const { id } of DEVICE_TRUST_PREVIEW_SCENARIOS) {
      deviceTrustPreviewSession.open(id);
      const choices = deviceTrustPreviewSession.getState().session?.view?.choices ?? [];
      for (const { choice } of choices) {
        await deviceTrustPreviewSession.getState().session?.choose(choice);
        await deviceTrustPreviewSession.getState().session?.proceed();
        deviceTrustPreviewSession.getState().session?.cancelConfirmation();
        await deviceTrustPreviewSession.getState().session?.choose(choice);
        await deviceTrustPreviewSession.getState().session?.proceed();
        await deviceTrustPreviewSession.getState().session?.confirm();
      }
      deviceTrustPreviewSession.getState().session?.dismiss?.();
    }

    expect(useUnifiedSpaceStore.getState()).toBe(authoritativeBefore);
  });
});
