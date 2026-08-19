const mockApplication = { applicationId: 'app.uniclipboard.android.dev' as string | null };

jest.mock('expo-application', () => ({
  get applicationId() {
    return mockApplication.applicationId;
  },
}));

import { createInitialUnifiedSpaceSnapshot, useUnifiedSpaceStore } from '../features/space/store';
import {
  closeDeviceTrustPreview,
  isDeviceTrustPreviewAvailable,
  openDeviceTrustPreview,
} from '../devtools/deviceTrustPreviewCoordinator';
import { deviceTrustPreviewSession } from '../devtools/deviceTrustPreviewSession';

function resetSpace() {
  useUnifiedSpaceStore.setState(createInitialUnifiedSpaceSnapshot('ready'), true);
}

describe('device trust preview coordinator', () => {
  beforeEach(() => {
    mockApplication.applicationId = 'app.uniclipboard.android.dev';
    resetSpace();
    closeDeviceTrustPreview();
  });

  it('is available only to an isolated development application identity', () => {
    expect(isDeviceTrustPreviewAvailable()).toBe(true);

    mockApplication.applicationId = 'app.uniclipboard.android';

    expect(isDeviceTrustPreviewAvailable()).toBe(false);
    expect(openDeviceTrustPreview('standard')).toBe(false);
    expect(deviceTrustPreviewSession.getState().session).toBeNull();
  });

  it('refuses to open while an authoritative decision is present', () => {
    useUnifiedSpaceStore.setState({
      deviceTrustQuery: {
        kind: 'ready',
        snapshot: {
          revision: 1,
          localDeviceId: 'phone',
          localMembership: 'active',
          currentChange: {
            changeId: 'real-change',
            proposedByDeviceId: 'desktop',
            targetDeviceIds: ['tablet'],
            includesLocalDevice: false,
            applyImpact: {
              usableDeviceIds: ['phone', 'desktop', 'tablet'],
              pausedDeviceIds: [],
              localDeviceOutcome: 'active',
              requiresRejoinDeviceIds: [],
            },
            keepCurrentImpact: {
              usableDeviceIds: ['phone', 'desktop'],
              pausedDeviceIds: ['tablet'],
              localDeviceOutcome: 'active',
              requiresRejoinDeviceIds: ['tablet'],
            },
            allowedChoices: ['applyChange', 'keepCurrentDeviceGroup'],
            blockedReason: null,
          },
          devices: [],
          recovery: 'notAvailableInThisVersion',
          allowedActions: [],
          blockedReason: null,
          updatedAtMs: 1,
        },
      },
    });

    expect(openDeviceTrustPreview('standard')).toBe(false);
    expect(deviceTrustPreviewSession.getState().session).toBeNull();
  });

  it.each([
    { deviceTrustDecisionStatus: 'submitting' as const },
    { deviceTrustDecisionError: 'failed' },
    { deviceTrustDecisionOutcome: 'stateChanged' as const },
    { operationState: { kind: 'result' as const, result: {} as never } },
  ])('refuses to open while authoritative work is active', (state) => {
    useUnifiedSpaceStore.setState(state);

    expect(openDeviceTrustPreview('standard')).toBe(false);
  });
});
