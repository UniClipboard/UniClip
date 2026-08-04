/// <reference types="jest" />
/// <reference types="node" />

import fs from 'node:fs';
import path from 'node:path';
import * as analytics from '../support/observability';

type TestAnalyticsState = Parameters<typeof analytics.createPostHogOptions>[0];

function nativeState(overrides: Partial<TestAnalyticsState> = {}): TestAnalyticsState {
  return {
    projectKey: 'phc_test',
    consentEnabled: true,
    distinctId: 'person-id',
    anonymousId: 'anonymous-id',
    deviceId: 'device-id',
    spaceGroupKey: 'space-hash',
    isIdentified: true,
    ...overrides,
  };
}

function postHogClient() {
  return {
    ready: jest.fn(async () => undefined),
    optIn: jest.fn(async () => undefined),
    optOut: jest.fn(async () => undefined),
    reset: jest.fn(),
    setPersistedProperty: jest.fn(),
    screen: jest.fn(),
    shutdown: jest.fn(async () => undefined),
    identify: jest.fn(),
  };
}

describe('React Native PostHog analytics', () => {
  it('provides a dedicated foreground analytics service', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'src/support/observability/index.ts'))).toBe(
      true
    );
  });

  it('keeps SDK configuration, filtering, startup, and screen capture behind one service', () => {
    expect(analytics.createPostHogOptions).toEqual(expect.any(Function));
    expect(analytics.filterPostHogEvent).toEqual(expect.any(Function));
    expect(analytics.startPostHogAnalytics).toEqual(expect.any(Function));
    expect(analytics.stopPostHogAnalytics).toEqual(expect.any(Function));
    expect(analytics.capturePostHogScreen).toEqual(expect.any(Function));
    expect(analytics.PostHogAnalyticsController).toEqual(expect.any(Function));
    expect(analytics.PostHogAnalyticsController.prototype.start).toEqual(expect.any(Function));
    expect(analytics.PostHogAnalyticsController.prototype.synchronize).toEqual(
      expect.any(Function)
    );
    expect(analytics.PostHogAnalyticsController.prototype.captureScreen).toEqual(
      expect.any(Function)
    );
    expect(analytics.PostHogAnalyticsController.prototype.stop).toEqual(expect.any(Function));
  });

  it('disables SDK collection that can include links, UI text, device names, or remote data', () => {
    const options = analytics.createPostHogOptions({
      projectKey: 'phc_test',
      consentEnabled: true,
      distinctId: 'person-id',
      anonymousId: 'anonymous-id',
      deviceId: 'device-id',
      spaceGroupKey: 'space-hash',
      isIdentified: true,
    });

    expect(options).toMatchObject({
      host: 'https://us.i.posthog.com',
      defaultOptIn: false,
      captureAppLifecycleEvents: false,
      disableRemoteFeatureFlags: true,
      preloadFeatureFlags: false,
      disableSurveys: true,
      enableSessionReplay: false,
      sendFeatureFlagEvent: false,
      disableGeoip: true,
      persistence: 'file',
      bootstrap: { distinctId: 'person-id', isIdentifiedId: true },
    });
    expect(options.before_send).toBe(analytics.filterPostHogEvent);

    const customAppProperties = options.customAppProperties as (
      properties: Record<string, unknown>
    ) => Record<string, unknown>;
    expect(
      customAppProperties({
        $app_version: '1.3.0',
        $os_name: 'iOS',
        $device_name: 'Private Phone',
      })
    ).toEqual({ $app_version: '1.3.0', $os_name: 'iOS' });
  });

  it.each(['Onboarding', 'Migration', 'Main', 'Settings', 'SettingsSub'])(
    'allows the static %s screen name',
    (screenName) => {
      const event = { event: '$screen', properties: { $screen_name: screenName } };
      expect(analytics.filterPostHogEvent(event)).toBe(event);
    }
  );

  it.each([
    ['unknown event', { event: 'clipboard_copied', properties: {} }],
    ['dynamic screen', { event: '$screen', properties: { $screen_name: 'Settings/private' } }],
    ['clipboard content', { event: '$screen', properties: { clipboard_content: 'secret' } }],
    ['device name', { event: '$screen', properties: { $device_name: 'Private Phone' } }],
    ['file name', { event: '$screen', properties: { filename: 'private.txt' } }],
    ['path value', { event: '$screen', properties: { source: 'file:///Users/mark/private.txt' } }],
    ['credential', { event: '$screen', properties: { access_token: 'secret' } }],
  ])('drops %s before it reaches PostHog', (_label, event) => {
    expect(analytics.filterPostHogEvent(event)).toBeNull();
  });

  it('starts with native identity and captures only a static screen plus safe grouping', async () => {
    let listener: ((reason: 'refresh' | 'reset') => void) | undefined;
    const client = postHogClient();
    const createClient = jest.fn(() => client);
    const controller = new analytics.PostHogAnalyticsController({
      loadState: jest.fn(async () => nativeState()),
      subscribe: (next) => {
        listener = next;
        return jest.fn();
      },
      createClient,
    });

    await controller.start();

    expect(listener).toEqual(expect.any(Function));
    expect(createClient).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({
        defaultOptIn: false,
        captureAppLifecycleEvents: false,
        customStorage: expect.any(Object),
      })
    );
    expect(client.ready).toHaveBeenCalledTimes(1);
    expect(client.setPersistedProperty).toHaveBeenCalledWith('anonymous_id', 'anonymous-id');
    expect(client.setPersistedProperty).toHaveBeenCalledWith('distinct_id', 'person-id');
    expect(client.setPersistedProperty).toHaveBeenCalledWith('device_id', 'device-id');
    expect(client.setPersistedProperty).toHaveBeenCalledWith('person_mode', 'identified');
    expect(client.optIn).toHaveBeenCalledTimes(1);

    controller.captureScreen('Main');
    controller.captureScreen('Settings/private');

    expect(client.screen).toHaveBeenCalledTimes(1);
    expect(client.screen).toHaveBeenCalledWith('Main', {
      analytics_device_id: 'device-id',
      analytics_source: 'react_native',
      space_id_hash: 'space-hash',
      $groups: { space: 'space-hash' },
    });
  });

  it('retains the initial static screen until native consent and identity are ready', async () => {
    const client = postHogClient();
    const controller = new analytics.PostHogAnalyticsController({
      loadState: jest.fn(async () => nativeState()),
      subscribe: () => jest.fn(),
      createClient: () => client,
    });

    controller.captureScreen('Main');
    await controller.start();

    expect(client.screen).toHaveBeenCalledWith('Main', expect.any(Object));
  });

  it('does not create a client while consent is off and clears an active queue when disabled', async () => {
    let state = nativeState();
    const client = postHogClient();
    const createClient = jest.fn(() => client);
    const controller = new analytics.PostHogAnalyticsController({
      loadState: jest.fn(async () => state),
      subscribe: () => jest.fn(),
      createClient,
    });

    await controller.start();
    state = nativeState({ consentEnabled: false });
    await controller.synchronize('refresh');

    for (const queue of ['queue', 'ai_queue', 'logs_queue']) {
      expect(client.setPersistedProperty).toHaveBeenCalledWith(queue, null);
    }
    expect(client.optOut).toHaveBeenCalledTimes(1);
    expect(client.shutdown).toHaveBeenCalledTimes(1);
    controller.captureScreen('Main');
    expect(client.screen).not.toHaveBeenCalled();

    const disabledFactory = jest.fn(() => postHogClient());
    const disabledController = new analytics.PostHogAnalyticsController({
      loadState: jest.fn(async () => nativeState({ consentEnabled: false })),
      subscribe: () => jest.fn(),
      createClient: disabledFactory,
    });
    await disabledController.start();
    expect(disabledFactory).not.toHaveBeenCalled();
  });

  it('clears queued data and silently adopts the new native identity on reset', async () => {
    let state = nativeState();
    const client = postHogClient();
    const controller = new analytics.PostHogAnalyticsController({
      loadState: jest.fn(async () => state),
      subscribe: () => jest.fn(),
      createClient: () => client,
    });
    await controller.start();
    client.setPersistedProperty.mockClear();

    state = nativeState({
      distinctId: 'new-anonymous-id',
      anonymousId: 'new-anonymous-id',
      deviceId: 'new-device-id',
      spaceGroupKey: null,
      isIdentified: false,
    });
    await controller.synchronize('reset');

    expect(client.reset).toHaveBeenCalledTimes(1);
    expect(client.setPersistedProperty).toHaveBeenCalledWith('queue', null);
    expect(client.setPersistedProperty).toHaveBeenCalledWith('anonymous_id', 'new-anonymous-id');
    expect(client.setPersistedProperty).toHaveBeenCalledWith('distinct_id', null);
    expect(client.setPersistedProperty).toHaveBeenCalledWith('device_id', 'new-device-id');
    expect(client.setPersistedProperty).toHaveBeenCalledWith('person_mode', 'anonymous');
    expect(client.identify).not.toHaveBeenCalled();
  });

  it('waits for in-flight native state synchronization before stopping the client', async () => {
    let resolveState: ((state: TestAnalyticsState) => void) | undefined;
    const state = new Promise<TestAnalyticsState>((resolve) => {
      resolveState = resolve;
    });
    const client = postHogClient();
    const controller = new analytics.PostHogAnalyticsController({
      loadState: () => state,
      subscribe: () => jest.fn(),
      createClient: () => client,
    });

    const start = controller.start();
    const stop = controller.stop();
    expect(client.shutdown).not.toHaveBeenCalled();

    resolveState?.(nativeState());
    await start;
    await stop;

    expect(client.shutdown).toHaveBeenCalledTimes(1);
  });

  it('starts with the main app and records navigation without route parameters', () => {
    const app = fs.readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
    const navigator = fs.readFileSync(
      path.join(process.cwd(), 'src/navigation/AppNavigator.tsx'),
      'utf8'
    );

    expect(app).toContain('startPostHogAnalytics');
    expect(app).toContain('stopPostHogAnalytics');
    expect(navigator).toContain('capturePostHogScreen');
    expect(navigator).toContain('onStateChange={captureCurrentScreen}');
    expect(navigator).toContain('navigationRef.getCurrentRoute()');
    expect(navigator).toContain('?.name');
    expect(navigator).not.toContain('capturePostHogScreen(route.params');
  });
});
