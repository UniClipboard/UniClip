import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AnalyticsState, AnalyticsStateChangeReason, AnalyticsStateListener } from 'uc-engine';
import type { PostHogCustomStorage, PostHogOptions } from 'posthog-react-native';

type BeforeSend = Exclude<PostHogOptions['before_send'], unknown[] | undefined>;
type BeforeSendEvent = NonNullable<Parameters<BeforeSend>[0]>;

const SAFE_SCREEN_NAMES = new Set(['Onboarding', 'Migration', 'Main', 'Settings', 'SettingsSub']);
const FORBIDDEN_KEYS = new Set([
  'clipboard',
  'clipboard_content',
  'device_name',
  'display_name',
  'file_name',
  'filename',
  'path',
  'password',
  'secret',
  'invitation_code',
  'credential',
  'access_token',
  'auth_token',
]);
const EVENTS_STORAGE_KEY = '.posthog-rn.json';
const LOGS_STORAGE_KEY = '.posthog-rn-logs.json';
const STORAGE_PREFIX = '@uniclip/posthog:';
const QUEUE_KEYS = ['queue', 'ai_queue', 'logs_queue'] as const;

type PostHogClient = {
  ready(): Promise<void>;
  optIn(): Promise<void>;
  optOut(): Promise<void>;
  reset(): void;
  setPersistedProperty(key: string, value: unknown | null): void;
  screen(name: string, properties?: Record<string, unknown>): void;
  shutdown(timeoutMs?: number): Promise<void>;
};

type ControllerDependencies = {
  loadState: () => Promise<AnalyticsState>;
  subscribe: (listener: AnalyticsStateListener) => () => void;
  createClient: (projectKey: string, options: PostHogOptions) => PostHogClient;
  storage?: PostHogCustomStorage;
};

type StoredPayload = {
  version: string;
  content: Record<string, unknown>;
};

const defaultStorage: PostHogCustomStorage = {
  getItem: (key) => AsyncStorage.getItem(`${STORAGE_PREFIX}${key}`),
  setItem: (key, value) => AsyncStorage.setItem(`${STORAGE_PREFIX}${key}`, value),
};

function containsSensitiveData(value: unknown, key?: string): boolean {
  if (key) {
    const normalized = key.toLowerCase().replace(/^\$+/, '').replaceAll('-', '_');
    if (
      FORBIDDEN_KEYS.has(normalized) ||
      normalized.endsWith('_path') ||
      normalized.endsWith('_content') ||
      normalized.endsWith('_credential') ||
      normalized.endsWith('_token')
    ) {
      return true;
    }
  }

  if (Array.isArray(value)) return value.some((item) => containsSensitiveData(item));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([childKey, child]) =>
      containsSensitiveData(child, childKey)
    );
  }
  if (typeof value !== 'string') return false;

  const normalized = value.toLowerCase();
  return (
    normalized.includes('file://') ||
    normalized.includes('content://') ||
    normalized.includes('/users/') ||
    normalized.includes('/var/mobile/') ||
    normalized.includes('/data/user/') ||
    /^[a-z]:\\/.test(normalized)
  );
}

export function filterPostHogEvent(event: BeforeSendEvent | null): BeforeSendEvent | null {
  if (!event || event.event !== '$screen') return null;
  const properties = event.properties as Record<string, unknown> | undefined;
  const screenName = properties?.$screen_name;
  if (typeof screenName !== 'string' || !SAFE_SCREEN_NAMES.has(screenName)) return null;
  return containsSensitiveData(properties) ? null : event;
}

export function createPostHogOptions(state: AnalyticsState): PostHogOptions {
  return {
    host: 'https://us.i.posthog.com',
    defaultOptIn: false,
    captureAppLifecycleEvents: false,
    disableRemoteFeatureFlags: true,
    preloadFeatureFlags: false,
    disableSurveys: true,
    enableSessionReplay: false,
    sendFeatureFlagEvent: false,
    setDefaultPersonProperties: false,
    disableGeoip: true,
    persistence: 'file',
    bootstrap: {
      distinctId: state.distinctId,
      isIdentifiedId: state.isIdentified,
    },
    customAppProperties: (properties) => {
      const safeProperties = { ...properties };
      delete safeProperties.$device_name;
      return safeProperties;
    },
    before_send: filterPostHogEvent,
  };
}

export class PostHogAnalyticsController {
  private readonly storage: PostHogCustomStorage;
  private client: PostHogClient | null = null;
  private clientProjectKey: string | null = null;
  private state: AnalyticsState | null = null;
  private unsubscribe: (() => void) | null = null;
  private started = false;
  private synchronization = Promise.resolve();
  private pendingScreenName: string | null = null;

  constructor(private readonly dependencies: ControllerDependencies) {
    this.storage = dependencies.storage ?? defaultStorage;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.unsubscribe = this.dependencies.subscribe((reason) => {
      void this.synchronize(reason).catch(() => undefined);
    });
    await this.synchronize('refresh');
  }

  synchronize(reason: AnalyticsStateChangeReason = 'refresh'): Promise<void> {
    const next = this.synchronization.then(() => this.applyNativeState(reason));
    this.synchronization = next.catch(() => undefined);
    return next;
  }

  captureScreen(name: string): void {
    const state = this.state;
    if (!SAFE_SCREEN_NAMES.has(name)) return;
    if (!this.client) {
      this.pendingScreenName = !state || state.consentEnabled ? name : null;
      return;
    }
    if (!state?.consentEnabled) return;
    const properties: Record<string, unknown> = {
      analytics_device_id: state.deviceId,
      analytics_source: 'react_native',
    };
    if (state.spaceGroupKey) {
      properties.space_id_hash = state.spaceGroupKey;
      properties.$groups = { space: state.spaceGroupKey };
    }
    this.client.screen(name, properties);
  }

  async stop(): Promise<void> {
    this.started = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.synchronization;
    const client = this.client;
    this.client = null;
    this.clientProjectKey = null;
    this.pendingScreenName = null;
    if (client) await client.shutdown(2_000);
  }

  private async applyNativeState(reason: AnalyticsStateChangeReason): Promise<void> {
    const state = await this.dependencies.loadState();
    this.state = state;
    const clearStoredData = reason === 'reset' || !state.consentEnabled;
    await this.prepareStorage(state, clearStoredData, reason === 'reset');

    if (!state.consentEnabled || !state.projectKey) {
      this.pendingScreenName = null;
      if (this.client) {
        this.clearClientQueues(this.client);
        await this.client.optOut();
        await this.client.shutdown(2_000);
      }
      this.client = null;
      this.clientProjectKey = null;
      return;
    }

    if (this.client && this.clientProjectKey !== state.projectKey) {
      await this.client.shutdown(2_000);
      this.client = null;
      this.clientProjectKey = null;
    }

    const existingClient = this.client;
    if (!this.client) {
      this.client = this.dependencies.createClient(state.projectKey, {
        ...createPostHogOptions(state),
        customStorage: this.storage,
      });
      this.clientProjectKey = state.projectKey;
      await this.client.ready();
    }

    const client = this.client;
    if (reason === 'reset' && existingClient) {
      this.clearClientQueues(client);
      client.reset();
    }
    this.applyIdentity(client, state);
    await client.optIn();
    if (this.pendingScreenName) {
      const screenName = this.pendingScreenName;
      this.pendingScreenName = null;
      this.captureScreen(screenName);
    }
  }

  private applyIdentity(client: PostHogClient, state: AnalyticsState): void {
    client.setPersistedProperty('anonymous_id', state.anonymousId);
    client.setPersistedProperty('distinct_id', state.isIdentified ? state.distinctId : null);
    client.setPersistedProperty('device_id', state.deviceId);
    client.setPersistedProperty('person_mode', state.isIdentified ? 'identified' : 'anonymous');
  }

  private clearClientQueues(client: PostHogClient): void {
    for (const key of QUEUE_KEYS) client.setPersistedProperty(key, null);
  }

  private async prepareStorage(
    state: AnalyticsState,
    clearQueues: boolean,
    clearIdentityState: boolean
  ): Promise<void> {
    const raw = await this.storage.getItem(EVENTS_STORAGE_KEY);
    const payload = clearIdentityState ? this.emptyPayload() : this.parsePayload(raw);
    const content = payload.content;
    content.anonymous_id = state.anonymousId;
    content.device_id = state.deviceId;
    content.opted_out = !state.consentEnabled;
    if (state.isIdentified) {
      content.distinct_id = state.distinctId;
      content.person_mode = 'identified';
    } else {
      delete content.distinct_id;
      content.person_mode = 'anonymous';
    }
    if (clearQueues) {
      delete content.queue;
      delete content.ai_queue;
    }
    await this.storage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(payload));
    if (clearQueues) {
      await this.storage.setItem(LOGS_STORAGE_KEY, JSON.stringify(this.emptyPayload()));
    }
  }

  private parsePayload(raw: string | null): StoredPayload {
    if (!raw) return this.emptyPayload();
    try {
      const parsed = JSON.parse(raw) as Partial<StoredPayload>;
      if (!parsed.content || typeof parsed.content !== 'object') return this.emptyPayload();
      return { version: 'v1', content: { ...parsed.content } };
    } catch {
      return this.emptyPayload();
    }
  }

  private emptyPayload(): StoredPayload {
    return { version: 'v1', content: {} };
  }
}

function nativeAnalyticsModule(): typeof import('uc-engine') {
  return require('uc-engine') as typeof import('uc-engine');
}

const controller = new PostHogAnalyticsController({
  loadState: () => nativeAnalyticsModule().getAnalyticsState(),
  subscribe: (listener) => nativeAnalyticsModule().subscribeAnalyticsState(listener),
  createClient: (projectKey, options) => {
    const PostHog = require('posthog-react-native').default as new (
      key: string,
      clientOptions: PostHogOptions
    ) => PostHogClient;
    return new PostHog(projectKey, options);
  },
});

export function startPostHogAnalytics(): Promise<void> {
  return controller.start();
}

export function stopPostHogAnalytics(): Promise<void> {
  return controller.stop();
}

export function capturePostHogScreen(name: string): void {
  controller.captureScreen(name);
}
