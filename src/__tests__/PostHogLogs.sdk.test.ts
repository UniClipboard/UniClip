import PostHog from 'posthog-react-native';
import { gunzipSync } from 'node:zlib';
import { PostHogAnalyticsController } from '../support/observability/internal/postHogAnalytics';

describe('PostHog logs SDK delivery', () => {
  it('sends approved records to the logs endpoint and does not replay a disabled queue', async () => {
    let consentEnabled = true;
    const stored = new Map<string, string>();
    const storage = {
      getItem: async (key: string) => stored.get(key) ?? null,
      setItem: async (key: string, value: string) => { stored.set(key, value); },
    };
    const requests: { url: string; body: string }[] = [];
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (url, options) => {
      const body = options?.body instanceof Blob
        ? gunzipSync(Buffer.from(await options.body.arrayBuffer())).toString()
        : String(options?.body ?? '');
      requests.push({ url: String(url), body });
      return { status: 200, text: async () => '', json: async () => ({}) } as Response;
    });
    let sdk: PostHog | undefined;
    const controller = new PostHogAnalyticsController({
      loadState: async () => ({
        projectKey: 'phc_test', consentEnabled, distinctId: 'anonymous-id',
        anonymousId: 'anonymous-id', deviceId: 'device-id', isIdentified: false, spaceGroupKey: null,
      }),
      subscribe: () => () => {}, storage,
      createClient: (key, options) => {
        sdk = new PostHog(key, options);
        return sdk;
      },
    });
    try {
      await controller.start();
      controller.captureLog('error', 'UnifiedSpaceService', [
        'Join space failed', { errorCode: 1237, password: 'secret-payload' },
      ]);
      await sdk!.flushLogs();
      const logs = requests.filter((request) => request.url.includes('/i/v1/logs'));
      expect(logs).toHaveLength(1);
      expect(logs[0].body).toContain('Join space failed');
      expect(logs[0].body).toContain('uniclip-mobile');
      expect(logs[0].body).not.toContain('secret-payload');
      controller.captureLog('info', 'P2pSyncAdapter', ['P2P space state', { deviceCount: 2 }]);
      consentEnabled = false;
      await controller.synchronize();
      consentEnabled = true;
      await controller.synchronize();
      await sdk!.flushLogs();
      expect(requests.filter((request) => request.url.includes('/i/v1/logs'))).toHaveLength(1);
      expect(JSON.stringify([...stored.values()])).not.toContain('P2P space state');
    } finally {
      await controller.stop();
      fetchMock.mockRestore();
    }
  });

  it('retains a failed delivery for retry and removes pending logs on identity reset', async () => {
    const storageData = new Map<string, string>();
    const storage = {
      getItem: async (key: string) => storageData.get(key) ?? null,
      setItem: async (key: string, value: string) => { storageData.set(key, value); },
    };
    let offline = true;
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () => {
      if (offline) throw new Error('offline');
      return { status: 200, text: async () => '', json: async () => ({}) } as Response;
    });
    let sdk: PostHog | undefined;
    const controller = new PostHogAnalyticsController({
      loadState: async () => ({
        projectKey: 'phc_test', consentEnabled: true, distinctId: 'anonymous-id',
        anonymousId: 'anonymous-id', deviceId: 'device-id', isIdentified: false, spaceGroupKey: null,
      }),
      subscribe: () => () => {}, storage,
      createClient: (key, options) => {
        sdk = new PostHog(key, { ...options, fetchRetryCount: 0 });
        return sdk;
      },
    });
    try {
      await controller.start();
      controller.captureLog('error', 'UnifiedSpaceService', ['Join space failed']);
      await expect(sdk!.flushLogs()).rejects.toThrow();
      expect(sdk!.getPersistedProperty('logs_queue' as never)).toHaveLength(1);
      offline = false;
      await sdk!.flushLogs();
      expect(sdk!.getPersistedProperty('logs_queue' as never)).toHaveLength(0);
      controller.captureLog('error', 'UnifiedSpaceService', ['Join space failed']);
      fetchMock.mockClear();
      await controller.synchronize('reset');
      await sdk!.flushLogs();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      offline = false;
      await controller.stop();
      fetchMock.mockRestore();
    }
  });
});
