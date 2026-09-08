import * as analytics from '../support/observability/internal/postHogAnalytics';
import { createPostHogLog, filterPostHogLog } from '../support/observability/internal/postHogLogs';

const state = {
  projectKey: 'phc_test', consentEnabled: true, distinctId: 'person-id',
  anonymousId: 'anonymous-id', deviceId: 'device-id', spaceGroupKey: null, isIdentified: true,
};

function client() {
  return {
    ready: jest.fn(async () => undefined), optIn: jest.fn(async () => undefined),
    optOut: jest.fn(async () => undefined), reset: jest.fn(),
    setPersistedProperty: jest.fn(), screen: jest.fn(), captureLog: jest.fn(),
    shutdown: jest.fn(async () => undefined),
  };
}

describe('PostHog mobile logs', () => {
  it('drops unsafe fields even if they reach the SDK directly', () => {
    expect(filterPostHogLog({ body: 'Join space failed', level: 'error',
      trace_id: 'untrusted', attributes: { source: 'UnifiedSpaceService',
        stage: 'private-stage', errorCode: NaN, clipboard_content: 'private text',
        distinct_id: 'private-user', file_name: 'private.txt', invitation_code: '123456',
      },
    })).toEqual({ body: 'Join space failed', level: 'error', attributes: { source: 'UnifiedSpaceService' } });
    expect(createPostHogLog('info', '__proto__', ['Join space failed'])).toBeNull();
    expect(createPostHogLog('error', 'UnifiedSpaceService', [new Error('private text')])).toBeNull();
  });

  it('never interrupts a caller when the SDK or an error object fails', async () => {
    const sdk = client();
    sdk.captureLog.mockImplementation(() => { throw new Error('network failure'); });
    const controller = new analytics.PostHogAnalyticsController({
      loadState: async () => state, subscribe: () => () => {}, createClient: () => sdk,
    });
    await controller.start();
    expect(() => controller.captureLog('error', 'UnifiedSpaceService', ['Join space failed'])).not.toThrow();
    expect(() => controller.captureLog('error', 'UnifiedSpaceService', ['Join space failed', {
      get errorCode() { throw new Error('bad getter'); },
    }])).not.toThrow();
  });
  it('configures bounded mobile delivery and a separate log filter', () => {
    expect(analytics.createPostHogOptions(state).logs).toMatchObject({
      serviceName: 'uniclip-mobile', maxBufferSize: 50,
      rateCap: { maxLogs: 100, windowMs: 10_000 }, beforeSend: expect.any(Function),
    });
  });

  it('forwards approved diagnostics with only safe fields, never raw errors or content', async () => {
    const sdk = client();
    const controller = new analytics.PostHogAnalyticsController({
      loadState: async () => state, subscribe: () => () => {}, createClient: () => sdk,
    });
    await controller.start();
    expect(controller.captureLog).toEqual(expect.any(Function));
    controller.captureLog('error', 'UnifiedSpaceService', ['Join space failed', {
      stage: 'requestJoin', hadExistingSpace: true, errorCode: 1237,
      errorName: 'private name', password: 'private password', clipboard: 'private text',
      nested: { filename: 'private.png' },
    }]);
    expect(sdk.captureLog).toHaveBeenCalledWith({
      body: 'Join space failed', level: 'error', attributes: {
        source: 'UnifiedSpaceService', stage: 'requestJoin', hadExistingSpace: true,
        errorCode: 1237,
      },
    });
    controller.captureLog('error', 'UnifiedSpaceService', ['Join space failed: private text']);
    controller.captureLog('error', 'private source', ['Join space failed']);
    controller.captureLog('debug', 'UnifiedSpaceService', ['Join space failed']);
    expect(sdk.captureLog).toHaveBeenCalledTimes(1);
  });

  it('disables delivery before waiting for disk cleanup, even when storage fails', async () => {
    let current = state;
    let failStorage = false;
    const sdk = client();
    const controller = new analytics.PostHogAnalyticsController({
      loadState: async () => current, subscribe: () => () => {}, createClient: () => sdk,
      storage: { getItem: async () => null, setItem: async () => {
        if (failStorage) throw new Error('disk unavailable');
      } },
    });
    await controller.start();
    current = { ...state, consentEnabled: false };
    failStorage = true;
    await expect(controller.synchronize()).rejects.toThrow('disk unavailable');
    expect(sdk.optOut).toHaveBeenCalled();
    expect(sdk.setPersistedProperty).toHaveBeenCalledWith('logs_queue', null);
    expect(sdk.shutdown).toHaveBeenCalled();
  });

  it('clears persisted logs even if the SDK shutdown fails', async () => {
    let current = state;
    const sdk = client();
    const setItem = jest.fn(async () => undefined);
    const controller = new analytics.PostHogAnalyticsController({
      loadState: async () => current, subscribe: () => () => {}, createClient: () => sdk,
      storage: { getItem: async () => null, setItem },
    });
    await controller.start();
    setItem.mockClear();
    sdk.shutdown.mockRejectedValue(new Error('shutdown failed'));
    current = { ...state, consentEnabled: false };
    await expect(controller.synchronize()).rejects.toThrow('shutdown failed');
    expect(setItem).toHaveBeenCalledWith('.posthog-rn-logs.json', JSON.stringify({ version: 'v1', content: {} }));
  });
});
