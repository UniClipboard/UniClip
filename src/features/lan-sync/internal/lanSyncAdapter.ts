import type { ClipboardContent } from '@/types/clipboard';
import { File } from 'expo-file-system';
import { clearTimer, setTimer } from 'native-timer';
import { countGraphemes, splitGraphemes } from 'unicode-segmenter/grapheme';
import type { LanServerDraft } from '@/features/lan-servers';
import { prepareTempFilePath } from '@/platform/files';
import { sanitizeDataName } from '@/utils/fileName';
import type {
  SyncAdapter,
  SyncAdapterDelivery,
  SyncAdapterEvent,
  SyncImportedAsset,
  SyncRuntimePolicy,
  SyncSendOptions,
  SyncStartContext,
} from '@/features/sync/contracts';
import {
  LanHttpClient,
  LanUnavailableError,
  type LanClipboardDocument,
  type LanPayloadUpload,
  type LanSseEvent,
  type LanSseListener,
} from './lanHttpClient';

const FOREGROUND_POLL_MS = 2000;
const BACKGROUND_POLL_MS = 15000;
const SSE_CONNECTED_POLL_MS = 30000;
const SSE_RETRY_BASE_MS = 1000;
const SSE_RETRY_MAX_MS = 30000;
const SSE_FAILURE_LIMIT = 5;
const SSE_REPROBE_MS = 5 * 60 * 1000;
const INLINE_TEXT_LIMIT = 10240;

export interface ApplyLanRemoteContentInput {
  type: 'Text' | 'Image' | 'File';
  text: string;
  profileHash: string;
  contentId?: string;
  hasData: boolean;
  dataName?: string;
  fileUri?: string;
  size: number;
}

interface LanHttpPort {
  getClipboard(
    server: LanServerDraft
  ): Promise<{ document: LanClipboardDocument; url: string } | null>;
  putClipboard(
    server: LanServerDraft,
    document: LanClipboardDocument,
    payload?: LanPayloadUpload
  ): Promise<{ url: string }>;
  downloadPayload(
    server: LanServerDraft,
    baseUrl: string,
    name: string,
    destinationUri: string
  ): Promise<string>;
  subscribeClipboardEvents?(server: LanServerDraft, listener: LanSseListener): () => void;
}

export interface LanSyncAdapterDependencies {
  getServer(serverId?: string): Promise<LanServerDraft | null>;
  getServers?(): Promise<LanServerDraft[]>;
  readClipboard(): Promise<ClipboardContent | null>;
  applyRemoteContent(input: ApplyLanRemoteContentInput): Promise<void>;
  preparePayloadTempUri(profileHash: string, dataName: string): string;
  client?: LanHttpPort;
}

const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
};

function graphemePreview(text: string, limit: number): string {
  let preview = '';
  let count = 0;
  for (const grapheme of splitGraphemes(text)) {
    if (count >= limit) break;
    preview += grapheme;
    count += 1;
  }
  return preview;
}

function payloadFileSize(uri: string): number {
  const file = new File(uri);
  return file.size ?? file.info().size ?? 0;
}

function fileExtension(uriOrName: string): string {
  const clean = uriOrName.split(/[?#]/, 1)[0];
  const dot = clean.lastIndexOf('.');
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : '';
}

function imageExtension(asset: SyncImportedAsset): string {
  const fromName = fileExtension(asset.fileName ?? asset.uri);
  if (fromName) return fromName === 'jpeg' ? 'jpg' : fromName;
  const fromMime = asset.mimeType
    ? IMAGE_EXTENSION_BY_MIME[asset.mimeType.toLowerCase()]
    : undefined;
  if (fromMime) return fromMime;
  throw new Error('LAN image type is unavailable');
}

function safeFileName(rawName: string | undefined, uri: string): string {
  const raw = rawName ?? uri.split(/[?#]/, 1)[0];
  const basename = raw.split('/').pop()?.split('\\').pop();
  return sanitizeDataName(basename);
}

const delivered = (): SyncAdapterDelivery => ({
  success: true,
  state: 'delivered',
  counts: { accepted: 1, duplicate: 0, offline: 0, errored: 0, pending: 0 },
});

export class LanSyncAdapter implements SyncAdapter {
  readonly id = 'lan' as const;
  private readonly client: LanHttpPort;
  private server: LanServerDraft | null = null;
  private policy: SyncRuntimePolicy = {
    appState: 'unknown',
    backgroundSyncEnabled: false,
  };
  private pollTimer: string | null = null;
  private sseRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelSse: (() => void) | null = null;
  private sseEpoch = 0;
  private sseConnected = false;
  private sseFailures = 0;
  private syncEpoch = 0;
  private synchronizePromise: Promise<void> | null = null;
  private synchronizePending = false;
  private running = false;
  private connected: boolean | null = null;
  private lastRemoteIdentity: string | null = null;
  private readonly subscribers = new Set<(event: SyncAdapterEvent) => void>();

  constructor(private readonly dependencies: LanSyncAdapterDependencies) {
    this.client = dependencies.client ?? new LanHttpClient();
  }

  async start(context: SyncStartContext): Promise<void> {
    this.policy = context.policy;
    this.server = await this.dependencies.getServer();
    this.running = true;
    if (!this.server) return;
    try {
      await this.synchronize();
    } catch (error) {
      this.emitConnectionFailure(error);
    }
    this.schedulePolling();
    this.startSse();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.syncEpoch += 1;
    this.synchronizePending = false;
    this.clearPolling();
    this.stopSse();
    this.server = null;
    this.connected = null;
    this.lastRemoteIdentity = null;
  }

  async refresh(policy: SyncRuntimePolicy): Promise<void> {
    this.policy = policy;
    const nextServer = await this.dependencies.getServer();
    const serverChanged = this.serverIdentity(this.server) !== this.serverIdentity(nextServer);
    if (serverChanged) {
      this.syncEpoch += 1;
      this.stopSse();
    }
    this.server = nextServer;
    if (!nextServer) {
      this.clearPolling();
      this.stopSse();
      this.connected = null;
      this.lastRemoteIdentity = null;
      return;
    }
    try {
      await this.synchronize();
    } catch (error) {
      this.emitConnectionFailure(error);
    }
    this.schedulePolling();
    this.startSse();
  }

  handleAppStateChange(policy: SyncRuntimePolicy): void {
    this.policy = policy;
    if (policy.appState === 'active') this.startSse();
    else this.stopSse();
    this.schedulePolling();
    if (policy.appState === 'active' && this.server)
      void this.synchronize().catch((error) => this.emitConnectionFailure(error));
  }

  async synchronize(): Promise<void> {
    if (this.synchronizePromise) {
      this.synchronizePending = true;
      return this.synchronizePromise;
    }
    const synchronizePromise = (async () => {
      do {
        this.synchronizePending = false;
        await this.synchronizeOnce();
      } while (this.synchronizePending && this.running && this.server);
    })();
    this.synchronizePromise = synchronizePromise;
    try {
      await synchronizePromise;
    } finally {
      if (this.synchronizePromise === synchronizePromise) this.synchronizePromise = null;
    }
  }

  private async synchronizeOnce(): Promise<void> {
    const server = this.server;
    if (!server) throw new Error('LAN adapter is not started');
    const epoch = this.syncEpoch;
    const result = await this.client.getClipboard(server);
    if (epoch !== this.syncEpoch || !this.running) return;
    this.emitConnectionRecovery();
    if (!result) return;
    const document = result.document;
    if (document.type === 'Group') throw new Error('LAN group content is not supported');
    if (!document.hash) throw new Error('LAN content is missing its content hash');
    const identity = document.contentId ?? document.hash;
    if (identity === this.lastRemoteIdentity) return;
    const current = await this.dependencies.readClipboard();
    if (current?.profileHash === document.hash) {
      this.lastRemoteIdentity = identity;
      return;
    }
    let fileUri: string | undefined;
    if (document.hasData) {
      if (!document.dataName) throw new Error('LAN payload is missing its data name');
      const destinationUri = this.dependencies.preparePayloadTempUri(
        document.hash,
        document.dataName
      );
      fileUri = await this.client.downloadPayload(
        server,
        result.url,
        document.dataName,
        destinationUri
      );
      if (epoch !== this.syncEpoch || !this.running) return;
    } else if (document.type !== 'Text') {
      throw new Error('LAN image or file is missing its payload');
    }
    await this.dependencies.applyRemoteContent({
      type: document.type,
      text: document.text,
      profileHash: document.hash,
      contentId: document.contentId,
      hasData: document.hasData,
      dataName: document.dataName,
      fileUri,
      size: document.size ?? Array.from(document.text).length,
    });
    if (epoch !== this.syncEpoch || !this.running) return;
    this.lastRemoteIdentity = identity;
    this.emit({ type: 'contentChanged' });
  }

  async sendCurrentClipboard(): Promise<SyncAdapterDelivery> {
    const content = await this.dependencies.readClipboard();
    if (!content) throw new Error('LAN clipboard content is unavailable');
    if (!content.profileHash) throw new Error('LAN clipboard content is missing its content hash');
    const profileHash = content.profileHash;
    if (content.type === 'Text') {
      const text =
        content.hasData && content.fileUri ? await new File(content.fileUri).text() : content.text;
      if (!text) throw new Error('LAN clipboard text is unavailable');
      return this.sendAutomatically((server) => this.pushText(server, text, profileHash));
    }
    if ((content.type === 'Image' || content.type === 'File') && content.fileUri) {
      const fileUri = content.fileUri;
      return this.sendAutomatically((server) =>
        this.pushAsset(
          server,
          {
            kind: content.type === 'Image' ? 'image' : 'file',
            uri: fileUri,
            fileName: content.fileName,
          },
          profileHash
        )
      );
    }
    throw new Error('LAN clipboard content is unavailable');
  }

  async sendImportedText(
    text: string,
    profileHash: string,
    options?: SyncSendOptions
  ): Promise<SyncAdapterDelivery> {
    if (options?.targetIds?.length) {
      return this.sendToTargets(options.targetIds, (server) =>
        this.pushText(server, text, profileHash)
      );
    }
    return this.sendAutomatically((server) => this.pushText(server, text, profileHash));
  }

  async sendImportedAsset(
    asset: SyncImportedAsset,
    profileHash: string,
    options?: SyncSendOptions
  ): Promise<SyncAdapterDelivery> {
    if (options?.targetIds?.length) {
      return this.sendToTargets(options.targetIds, (server) =>
        this.pushAsset(server, asset, profileHash)
      );
    }
    return this.sendAutomatically((server) => this.pushAsset(server, asset, profileHash));
  }

  async observeClipboardChange(
    content: ClipboardContent,
    dispatch: boolean
  ): Promise<SyncAdapterDelivery | null> {
    if (!dispatch) return null;
    if (!content.profileHash) throw new Error('LAN observed content is missing its content hash');
    const profileHash = content.profileHash;
    if (content.type === 'Text') {
      const text =
        content.hasData && content.fileUri ? await new File(content.fileUri).text() : content.text;
      if (text) {
        return this.sendAutomatically((server) => this.pushText(server, text, profileHash));
      }
    }
    if ((content.type === 'Image' || content.type === 'File') && content.fileUri) {
      const fileUri = content.fileUri;
      return this.sendAutomatically((server) =>
        this.pushAsset(
          server,
          {
            kind: content.type === 'Image' ? 'image' : 'file',
            uri: fileUri,
            fileName: content.fileName,
          },
          profileHash
        )
      );
    }
    throw new Error('LAN observed content is not supported');
  }

  subscribe(listener: (event: SyncAdapterEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  private async pushText(
    server: LanServerDraft,
    text: string,
    profileHash: string
  ): Promise<SyncAdapterDelivery> {
    const size = countGraphemes(text);
    let payload: LanPayloadUpload | undefined;
    let document: LanClipboardDocument = {
      type: 'Text',
      hash: profileHash,
      text,
      hasData: false,
      size,
    };
    if (size > INLINE_TEXT_LIMIT) {
      const dataName = `text_${profileHash}.txt`;
      const file = new File(prepareTempFilePath(dataName));
      file.write(text);
      document = {
        ...document,
        text: graphemePreview(text, INLINE_TEXT_LIMIT),
        hasData: true,
        dataName,
      };
      payload = {
        uri: file.uri,
        name: dataName,
        mimeType: 'text/plain; charset=utf-8',
      };
    }
    if (payload) {
      await this.client.putClipboard(server, document, payload);
    } else {
      await this.client.putClipboard(server, document);
    }
    if (this.serverIdentity(server) === this.serverIdentity(this.server)) {
      this.lastRemoteIdentity = profileHash;
    }
    return delivered();
  }

  private async pushAsset(
    server: LanServerDraft,
    asset: SyncImportedAsset,
    profileHash: string
  ): Promise<SyncAdapterDelivery> {
    const dataName =
      asset.kind === 'image'
        ? `image.${imageExtension(asset)}`
        : safeFileName(asset.fileName, asset.uri);
    await this.client.putClipboard(
      server,
      {
        type: asset.kind === 'image' ? 'Image' : 'File',
        hash: profileHash,
        text: dataName,
        hasData: true,
        dataName,
        size: payloadFileSize(asset.uri),
      },
      {
        uri: asset.uri,
        name: dataName,
        mimeType: asset.mimeType ?? undefined,
      }
    );
    if (this.serverIdentity(server) === this.serverIdentity(this.server)) {
      this.lastRemoteIdentity = profileHash;
    }
    return delivered();
  }

  private async sendToTargets(
    targetIds: string[],
    send: (server: LanServerDraft) => Promise<SyncAdapterDelivery>
  ): Promise<SyncAdapterDelivery> {
    const uniqueTargetIds = [...new Set(targetIds)];
    const results = await Promise.allSettled(
      uniqueTargetIds.map(async (targetId) => {
        const server = await this.dependencies.getServer(targetId);
        if (!server) throw new Error('LAN server not found');
        return send(server);
      })
    );
    return this.aggregateDeliveries(results);
  }

  private async sendAutomatically(
    send: (server: LanServerDraft) => Promise<SyncAdapterDelivery>
  ): Promise<SyncAdapterDelivery> {
    const servers = this.dependencies.getServers
      ? await this.dependencies.getServers()
      : this.server
      ? [this.server]
      : [];
    if (servers.length === 0) throw new Error('No LAN servers are configured');
    const results = await Promise.allSettled(servers.map((server) => send(server)));
    return this.aggregateDeliveries(results);
  }

  private aggregateDeliveries(
    results: PromiseSettledResult<SyncAdapterDelivery>[]
  ): SyncAdapterDelivery {
    const accepted = results.filter((result) => result.status === 'fulfilled').length;
    const offline = results.filter(
      (result) => result.status === 'rejected' && result.reason instanceof LanUnavailableError
    ).length;
    const errored = results.length - accepted - offline;
    const state =
      accepted === results.length
        ? 'delivered'
        : accepted > 0
        ? 'partial'
        : offline === results.length
        ? 'offline'
        : 'failed';
    return {
      success: accepted > 0,
      state,
      counts: { accepted, duplicate: 0, offline, errored, pending: 0 },
    };
  }

  private schedulePolling(): void {
    this.clearPolling();
    if (!this.running || !this.server) return;
    const interval =
      this.policy.appState === 'active'
        ? this.sseConnected
          ? SSE_CONNECTED_POLL_MS
          : FOREGROUND_POLL_MS
        : this.policy.backgroundSyncEnabled
        ? BACKGROUND_POLL_MS
        : null;
    if (!interval) return;
    // React Native pauses JS timers while the Android activity is paused, so background
    // polling must run on the native timer to keep receiving while the app is backgrounded.
    this.pollTimer = setTimer(() => {
      void this.synchronize().catch((error) => this.emitConnectionFailure(error));
    }, interval);
  }

  private clearPolling(): void {
    if (this.pollTimer) clearTimer(this.pollTimer);
    this.pollTimer = null;
  }

  private startSse(): void {
    if (
      !this.running ||
      !this.server ||
      this.policy.appState !== 'active' ||
      this.cancelSse ||
      !this.client.subscribeClipboardEvents
    )
      return;
    this.clearSseRetry();
    const epoch = ++this.sseEpoch;
    this.cancelSse = this.client.subscribeClipboardEvents(this.server, {
      onEvent: (event) => this.handleSseEvent(epoch, event),
      onDisconnected: (error) => this.handleSseDisconnected(epoch, error),
    });
  }

  private stopSse(): void {
    this.sseEpoch += 1;
    this.cancelSse?.();
    this.cancelSse = null;
    this.sseConnected = false;
    this.sseFailures = 0;
    this.clearSseRetry();
  }

  private handleSseEvent(epoch: number, event: LanSseEvent): void {
    if (epoch !== this.sseEpoch || !this.running) return;
    if (event.type === 'hello') {
      this.sseConnected = true;
      this.sseFailures = 0;
      this.clearSseRetry();
      this.schedulePolling();
    } else if (event.type === 'update' && event.contentId === this.lastRemoteIdentity) {
      return;
    }
    void this.synchronize().catch((error) => this.emitConnectionFailure(error));
  }

  private handleSseDisconnected(epoch: number, error: Error): void {
    if (epoch !== this.sseEpoch || !this.running) return;
    this.cancelSse = null;
    this.sseConnected = false;
    this.sseFailures += 1;
    this.emitConnectionFailure(error);
    this.schedulePolling();
    const delay =
      this.sseFailures >= SSE_FAILURE_LIMIT
        ? SSE_REPROBE_MS
        : Math.min(SSE_RETRY_BASE_MS * 2 ** (this.sseFailures - 1), SSE_RETRY_MAX_MS);
    this.sseRetryTimer = setTimeout(() => {
      this.sseRetryTimer = null;
      this.startSse();
    }, delay);
  }

  private clearSseRetry(): void {
    if (this.sseRetryTimer) clearTimeout(this.sseRetryTimer);
    this.sseRetryTimer = null;
  }

  private serverIdentity(server: LanServerDraft | null): string | null {
    if (!server) return null;
    return JSON.stringify([server.urls, server.username, server.password, server.allowInsecureTls]);
  }

  private emit(event: SyncAdapterEvent): void {
    for (const subscriber of this.subscribers) subscriber(event);
  }

  private emitConnectionFailure(error: unknown): void {
    if (this.connected === false) return;
    this.connected = false;
    this.emit({
      type: 'connectionChanged',
      connected: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  private emitConnectionRecovery(): void {
    const wasDisconnected = this.connected === false;
    this.connected = true;
    if (wasDisconnected) this.emit({ type: 'connectionChanged', connected: true });
  }
}
