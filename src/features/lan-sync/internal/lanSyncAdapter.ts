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
  type LanPutResult,
  type LanSseEvent,
  type LanSseListener,
} from './lanHttpClient';
import { LanHistorySaveError } from './lanApplyErrors';
import { contentAlias, traceLan } from './lanSyncTrace';
import { scheduleOnce } from './lanTimers';

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
  /** The clipboard already holds this content from an earlier attempt; only save its history. */
  clipboardAlreadyApplied?: boolean;
}

interface LanHttpPort {
  getClipboard(
    server: LanServerDraft
  ): Promise<{ document: LanClipboardDocument; url: string } | null>;
  putClipboard(
    server: LanServerDraft,
    document: LanClipboardDocument,
    payload?: LanPayloadUpload
  ): Promise<LanPutResult>;
  downloadPayload(
    server: LanServerDraft,
    baseUrl: string,
    name: string,
    destinationUri: string
  ): Promise<string>;
  subscribeClipboardEvents?(server: LanServerDraft, listener: LanSseListener): () => void;
  invalidateRoutes?(): void;
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

/**
 * Receiving state for one configured desktop. Every desktop is received from independently: its
 * own subscription, polling, single-flight pull and record of what it last served.
 */
interface ServerReceiver {
  readonly key: string;
  server: LanServerDraft;
  pollTimer: string | null;
  cancelSseRetry: (() => void) | null;
  cancelSse: (() => void) | null;
  sseEpoch: number;
  sseConnected: boolean;
  sseFailures: number;
  syncEpoch: number;
  synchronizePromise: Promise<void> | null;
  synchronizePending: boolean;
  connected: boolean | null;
  lastRemoteIdentity: string | null;
  /** Latest content id announced by this desktop, and a counter of announcements. */
  notifiedIdentity: string | null;
  notificationCount: number;
  /** Uploads to this desktop whose reply has not arrived; their reply names what it stored. */
  readonly uploads: Set<Promise<unknown>>;
}

export class LanSyncAdapter implements SyncAdapter {
  readonly id = 'lan' as const;
  private readonly client: LanHttpPort;
  private readonly receivers = new Map<string, ServerReceiver>();
  private policy: SyncRuntimePolicy = {
    appState: 'unknown',
    backgroundSyncEnabled: false,
  };
  private running = false;
  /** Whether any desktop is reachable; null until the first outcome. */
  private connected: boolean | null = null;
  /**
   * Hash of the remote document this adapter is writing, or last wrote, to the clipboard. The
   * clipboard observer can read that write back (slowly in the background); it is not a new copy.
   */
  private appliedRemoteHash: string | null = null;
  /** Remote content that reached the clipboard but whose history record failed to save. */
  private historyPendingHash: string | null = null;
  /** Clipboard reads and writes for different desktops never interleave. */
  private clipboardTurn: Promise<void> = Promise.resolve();
  private readonly subscribers = new Set<(event: SyncAdapterEvent) => void>();

  constructor(private readonly dependencies: LanSyncAdapterDependencies) {
    this.client = dependencies.client ?? new LanHttpClient();
  }

  async start(context: SyncStartContext): Promise<void> {
    this.policy = context.policy;
    this.running = true;
    const servers = await this.configuredServers();
    if (!this.running) return;
    for (const server of servers) this.addReceiver(server);
    await this.synchronizeEach([...this.receivers.values()]);
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const receiver of this.receivers.values()) this.closeReceiver(receiver);
    this.receivers.clear();
    this.connected = null;
    this.appliedRemoteHash = null;
    this.historyPendingHash = null;
  }

  async refresh(policy: SyncRuntimePolicy): Promise<void> {
    this.policy = policy;
    const servers = await this.configuredServers();
    const keys = new Set(servers.map((server) => this.serverIdentity(server)));
    for (const receiver of [...this.receivers.values()]) {
      if (keys.has(receiver.key)) continue;
      this.closeReceiver(receiver);
      this.receivers.delete(receiver.key);
    }
    if (this.receivers.size === 0 && servers.length === 0) {
      this.connected = null;
      this.appliedRemoteHash = null;
      this.historyPendingHash = null;
      return;
    }
    for (const server of servers) {
      if (!this.receivers.has(this.serverIdentity(server))) this.addReceiver(server);
    }
    for (const receiver of this.receivers.values()) {
      this.schedulePolling(receiver);
      this.reconcileSse(receiver);
    }
    await this.synchronizeEach([...this.receivers.values()]);
  }

  handleAppStateChange(policy: SyncRuntimePolicy): void {
    this.policy = policy;
    for (const receiver of this.receivers.values()) {
      // A usable subscription survives the foreground/background switch when background receiving
      // is allowed; it is only closed when this state no longer permits receiving.
      this.reconcileSse(receiver);
      this.schedulePolling(receiver);
      if (policy.appState === 'active')
        void this.synchronizeReceiver(receiver).catch((error) =>
          this.emitConnectionFailure(receiver, error)
        );
    }
  }

  /**
   * The device's network changed: routes verified on the old network are dropped and the
   * subscriptions, which may be half-open on the old network, are rebuilt.
   */
  handleNetworkChange(): void {
    this.client.invalidateRoutes?.();
    if (!this.running) return;
    for (const receiver of this.receivers.values()) {
      this.stopSse(receiver);
      this.reconcileSse(receiver);
    }
  }

  /** Pulls from every desktop; fails only when none of them could be read. */
  async synchronize(): Promise<void> {
    const receivers = [...this.receivers.values()];
    if (receivers.length === 0) throw new Error('LAN adapter is not started');
    const results = await Promise.allSettled(receivers.map((r) => this.synchronizeReceiver(r)));
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    if (failures.length === results.length) throw failures[0].reason;
  }

  private async synchronizeEach(receivers: ServerReceiver[]): Promise<void> {
    await Promise.all(
      receivers.map((receiver) =>
        this.synchronizeReceiver(receiver).catch((error) =>
          this.emitConnectionFailure(receiver, error)
        )
      )
    );
  }

  private async synchronizeReceiver(receiver: ServerReceiver): Promise<void> {
    // A pull already in flight absorbs this request; the time until it starts is single-flight wait.
    traceLan('sync_request', { inflight: receiver.synchronizePromise !== null });
    if (receiver.synchronizePromise) {
      receiver.synchronizePending = true;
      return receiver.synchronizePromise;
    }
    const synchronizePromise = (async () => {
      do {
        receiver.synchronizePending = false;
        await this.synchronizeOnce(receiver);
      } while (receiver.synchronizePending && this.isActive(receiver));
    })();
    receiver.synchronizePromise = synchronizePromise;
    try {
      await synchronizePromise;
    } finally {
      if (receiver.synchronizePromise === synchronizePromise) receiver.synchronizePromise = null;
    }
  }

  private async synchronizeOnce(receiver: ServerReceiver): Promise<void> {
    const server = receiver.server;
    traceLan('sync_start');
    const epoch = receiver.syncEpoch;
    const notificationsAtStart = receiver.notificationCount;
    const result = await this.client.getClipboard(server);
    if (epoch !== receiver.syncEpoch || !this.isActive(receiver)) return;
    this.emitConnectionRecovery(receiver);
    if (!result) return;
    const document = result.document;
    if (document.type === 'Group') throw new Error('LAN group content is not supported');
    if (!document.hash) throw new Error('LAN content is missing its content hash');
    const identity = document.contentId ?? document.hash;
    if (identity === receiver.lastRemoteIdentity) return;
    if (receiver.uploads.size > 0) {
      // This may be the desktop serving an upload of ours whose reply has not arrived yet; the
      // reply names it. Wait for those uploads only, then decide.
      traceLan('remote_wait_upload', {
        cid: contentAlias(identity),
        uploads: receiver.uploads.size,
      });
      await Promise.allSettled([...receiver.uploads]);
      if (epoch !== receiver.syncEpoch || !this.isActive(receiver)) return;
      if (identity === receiver.lastRemoteIdentity) {
        traceLan('remote_own_upload', { cid: contentAlias(identity) });
        return;
      }
    }
    traceLan('remote_new', { cid: contentAlias(identity) });
    const hash: string = document.hash;
    const type = document.type;
    await this.takeClipboardTurn(async () => {
      if (epoch !== receiver.syncEpoch || !this.isActive(receiver)) return;
      const current = await this.dependencies.readClipboard();
      traceLan('clipboard_read_done', { cid: contentAlias(identity) });
      const clipboardHoldsDocument = current?.profileHash?.toUpperCase() === hash.toUpperCase();
      const historyRetry = clipboardHoldsDocument && this.historyPendingHash === hash.toUpperCase();
      if (clipboardHoldsDocument && !historyRetry) {
        receiver.lastRemoteIdentity = identity;
        return;
      }
      let fileUri: string | undefined;
      if (document.hasData) {
        if (!document.dataName) throw new Error('LAN payload is missing its data name');
        const destinationUri = this.dependencies.preparePayloadTempUri(hash, document.dataName);
        fileUri = await this.client.downloadPayload(
          server,
          result.url,
          document.dataName,
          destinationUri
        );
        if (epoch !== receiver.syncEpoch || !this.isActive(receiver)) return;
      } else if (type !== 'Text') {
        throw new Error('LAN image or file is missing its payload');
      }
      if (this.isSuperseded(receiver, identity, notificationsAtStart)) {
        // A newer copy was announced while this one was being fetched: never write the older one
        // back over it. The pending pull fetches the current snapshot.
        traceLan('remote_superseded', { cid: contentAlias(identity) });
        receiver.synchronizePending = true;
        return;
      }
      this.appliedRemoteHash = hash.toUpperCase();
      try {
        await this.dependencies.applyRemoteContent({
          type,
          text: document.text,
          profileHash: hash,
          contentId: document.contentId,
          hasData: document.hasData,
          dataName: document.dataName,
          fileUri,
          size: document.size ?? Array.from(document.text).length,
          ...(historyRetry ? { clipboardAlreadyApplied: true } : {}),
        });
      } catch (error) {
        if (error instanceof LanHistorySaveError) this.historyPendingHash = hash.toUpperCase();
        throw error;
      }
      this.historyPendingHash = null;
      if (epoch !== receiver.syncEpoch || !this.isActive(receiver)) return;
      receiver.lastRemoteIdentity = identity;
      this.emit({ type: 'contentChanged' });
    });
  }

  private takeClipboardTurn(work: () => Promise<void>): Promise<void> {
    const turn = this.clipboardTurn.then(work);
    this.clipboardTurn = turn.catch(() => undefined);
    return turn;
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
    const observedHash = content.profileHash?.toUpperCase() ?? null;
    // Once the clipboard holds something else, a later copy of the applied content is the user's.
    if (observedHash && observedHash !== this.appliedRemoteHash) this.appliedRemoteHash = null;
    if (!dispatch) return null;
    if (!content.profileHash) throw new Error('LAN observed content is missing its content hash');
    const profileHash = content.profileHash;
    if (observedHash === this.appliedRemoteHash) {
      // The server already holds this content: sending it back would publish a duplicate.
      traceLan('observe_suppressed', { cid: contentAlias(profileHash) });
      return null;
    }
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
    await this.upload(server, profileHash, () =>
      payload
        ? this.client.putClipboard(server, document, payload)
        : this.client.putClipboard(server, document)
    );
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
    await this.upload(server, profileHash, () =>
      this.client.putClipboard(
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
      )
    );
    return delivered();
  }

  /**
   * One upload to `server`. Its reply names what the desktop stored, which that desktop then
   * announces and serves: remembering it keeps our own upload from being applied back. Pulls that
   * find new content while the upload is unanswered wait for this reply before deciding.
   */
  private async upload(
    server: LanServerDraft,
    profileHash: string,
    put: () => Promise<LanPutResult>
  ): Promise<void> {
    const receiver = this.receivers.get(this.serverIdentity(server));
    const pending = put().then((result) => {
      if (receiver) receiver.lastRemoteIdentity = result.contentId ?? profileHash;
    });
    receiver?.uploads.add(pending);
    try {
      await pending;
    } finally {
      receiver?.uploads.delete(pending);
    }
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
    const servers = await this.configuredServers();
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

  private schedulePolling(receiver: ServerReceiver): void {
    this.clearPolling(receiver);
    if (!this.isActive(receiver)) return;
    const interval =
      this.policy.appState === 'active'
        ? receiver.sseConnected
          ? SSE_CONNECTED_POLL_MS
          : FOREGROUND_POLL_MS
        : this.policy.backgroundSyncEnabled
        ? receiver.sseConnected
          ? SSE_CONNECTED_POLL_MS
          : BACKGROUND_POLL_MS
        : null;
    if (!interval) return;
    // React Native pauses JS timers while the Android activity is paused, so background
    // polling must run on the native timer to keep receiving while the app is backgrounded.
    receiver.pollTimer = setTimer(() => {
      void this.synchronizeReceiver(receiver).catch((error) =>
        this.emitConnectionFailure(receiver, error)
      );
    }, interval);
  }

  private clearPolling(receiver: ServerReceiver): void {
    if (receiver.pollTimer) clearTimer(receiver.pollTimer);
    receiver.pollTimer = null;
  }

  private startSse(receiver: ServerReceiver): void {
    if (
      !this.isActive(receiver) ||
      !this.sseAllowed() ||
      receiver.cancelSse ||
      !this.client.subscribeClipboardEvents
    )
      return;
    this.clearSseRetry(receiver);
    const epoch = ++receiver.sseEpoch;
    receiver.cancelSse = this.client.subscribeClipboardEvents(receiver.server, {
      onEvent: (event) => this.handleSseEvent(receiver, epoch, event),
      onDisconnected: (error) => this.handleSseDisconnected(receiver, epoch, error),
    });
  }

  /** Foreground always receives; background only while the platform confirms it may run. */
  private sseAllowed(): boolean {
    return this.policy.appState === 'active' || this.policy.backgroundReceiveAllowed === true;
  }

  private reconcileSse(receiver: ServerReceiver): void {
    if (this.sseAllowed()) this.startSse(receiver);
    else this.stopSse(receiver);
  }

  private stopSse(receiver: ServerReceiver): void {
    receiver.sseEpoch += 1;
    receiver.cancelSse?.();
    receiver.cancelSse = null;
    receiver.sseConnected = false;
    receiver.sseFailures = 0;
    this.clearSseRetry(receiver);
  }

  private isSuperseded(
    receiver: ServerReceiver,
    identity: string,
    notificationsAtStart: number
  ): boolean {
    return (
      receiver.notificationCount !== notificationsAtStart &&
      receiver.notifiedIdentity !== null &&
      receiver.notifiedIdentity !== identity
    );
  }

  private handleSseEvent(receiver: ServerReceiver, epoch: number, event: LanSseEvent): void {
    if (epoch !== receiver.sseEpoch || !this.isActive(receiver)) return;
    if (event.type === 'update') {
      receiver.notifiedIdentity = event.contentId;
      receiver.notificationCount += 1;
    }
    if (event.type === 'hello') {
      receiver.sseConnected = true;
      receiver.sseFailures = 0;
      this.clearSseRetry(receiver);
      this.schedulePolling(receiver);
    } else if (event.type === 'update' && event.contentId === receiver.lastRemoteIdentity) {
      return;
    }
    void this.synchronizeReceiver(receiver).catch((error) =>
      this.emitConnectionFailure(receiver, error)
    );
  }

  private handleSseDisconnected(receiver: ServerReceiver, epoch: number, error: Error): void {
    if (epoch !== receiver.sseEpoch || !this.isActive(receiver)) return;
    receiver.cancelSse = null;
    receiver.sseConnected = false;
    receiver.sseFailures += 1;
    this.emitConnectionFailure(receiver, error);
    this.schedulePolling(receiver);
    const delay =
      receiver.sseFailures >= SSE_FAILURE_LIMIT
        ? SSE_REPROBE_MS
        : Math.min(SSE_RETRY_BASE_MS * 2 ** (receiver.sseFailures - 1), SSE_RETRY_MAX_MS);
    const jittered = delay + Math.floor(Math.random() * Math.min(delay, 1000) * 0.3);
    // Native timer: a background reconnect must not stall while JS timers are paused.
    receiver.cancelSseRetry = scheduleOnce(() => {
      receiver.cancelSseRetry = null;
      this.startSse(receiver);
    }, jittered);
  }

  private clearSseRetry(receiver: ServerReceiver): void {
    receiver.cancelSseRetry?.();
    receiver.cancelSseRetry = null;
  }

  private async configuredServers(): Promise<LanServerDraft[]> {
    if (this.dependencies.getServers) return this.dependencies.getServers();
    const server = await this.dependencies.getServer();
    return server ? [server] : [];
  }

  private addReceiver(server: LanServerDraft): ServerReceiver {
    const receiver: ServerReceiver = {
      key: this.serverIdentity(server),
      server,
      pollTimer: null,
      cancelSseRetry: null,
      cancelSse: null,
      sseEpoch: 0,
      sseConnected: false,
      sseFailures: 0,
      syncEpoch: 0,
      synchronizePromise: null,
      synchronizePending: false,
      connected: null,
      lastRemoteIdentity: null,
      notifiedIdentity: null,
      notificationCount: 0,
      uploads: new Set(),
    };
    this.receivers.set(receiver.key, receiver);
    // The notification channel starts with the first pull; both share one route discovery.
    this.schedulePolling(receiver);
    this.startSse(receiver);
    return receiver;
  }

  private closeReceiver(receiver: ServerReceiver): void {
    receiver.syncEpoch += 1;
    receiver.synchronizePending = false;
    this.clearPolling(receiver);
    this.stopSse(receiver);
  }

  private isActive(receiver: ServerReceiver): boolean {
    return this.running && this.receivers.get(receiver.key) === receiver;
  }

  private serverIdentity(server: LanServerDraft): string {
    return JSON.stringify([server.urls, server.username, server.password, server.allowInsecureTls]);
  }

  private emit(event: SyncAdapterEvent): void {
    for (const subscriber of this.subscribers) subscriber(event);
  }

  /** Reported as disconnected only once no configured desktop is reachable. */
  private emitConnectionFailure(receiver: ServerReceiver, error: unknown): void {
    receiver.connected = false;
    if (this.connected === false) return;
    if ([...this.receivers.values()].some((r) => r.connected === true)) return;
    this.connected = false;
    this.emit({
      type: 'connectionChanged',
      connected: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  private emitConnectionRecovery(receiver: ServerReceiver): void {
    receiver.connected = true;
    const wasDisconnected = this.connected === false;
    this.connected = true;
    if (wasDisconnected) this.emit({ type: 'connectionChanged', connected: true });
  }
}
