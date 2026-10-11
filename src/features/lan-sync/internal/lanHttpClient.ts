import axios from 'axios';
import { fetch as expoFetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import { createParser, type EventSourceMessage } from 'eventsource-parser';
import { Base64 } from 'js-base64';
import { singleAttemptSender, type SingleAttemptRequest } from 'android-util';
import type { LanServerDraft } from '@/features/lan-servers';
import {
  ReactNativeBlobLanTransport,
  type LanInsecureHttpTransport,
} from './lanInsecureHttpTransport';
import { LanEndpointPool, lanServerKey, type RouteLease } from './lanEndpointPool';
import { contentAlias, routeRole, traceLan } from './lanSyncTrace';
import { scheduleOnce } from './lanTimers';

export interface LanClipboardDocument {
  type: 'Text' | 'Image' | 'File' | 'Group';
  hash?: string;
  contentId?: string;
  text: string;
  hasData: boolean;
  dataName?: string;
  size?: number;
}

export interface LanPayloadUpload {
  uri: string;
  name: string;
  mimeType?: string;
}

export type LanSseEvent =
  | { type: 'hello'; serverTimeMs: number }
  | { type: 'update'; contentId: string; serverTimeMs: number }
  | { type: 'resync'; serverTimeMs?: number };

export interface LanSseListener {
  onEvent(event: LanSseEvent): void;
  onDisconnected(error: Error): void;
}

type LanStreamFetch = typeof expoFetch;

interface LanHttpClientDependencies {
  uploadFile(
    sourceUri: string,
    url: string,
    headers: Record<string, string>
  ): Promise<{ status: number }>;
  downloadFile(
    url: string,
    destinationUri: string,
    headers: Record<string, string>
  ): Promise<string>;
  insecureTransport: LanInsecureHttpTransport;
  fetchStream: LanStreamFetch;
  /**
   * Sends a write exactly once (own connection, no transparent retry), or null where the platform
   * has none; the clipboard writes then use the transports above.
   */
  sendOnce: ((request: SingleAttemptRequest) => Promise<{ status: number; body: string }>) | null;
}

export class LanAuthenticationError extends Error {
  constructor() {
    super('LAN server authentication failed');
    this.name = 'LanAuthenticationError';
  }
}

export class LanUnavailableError extends Error {
  constructor() {
    super('LAN server is unavailable');
    this.name = 'LanUnavailableError';
  }
}

/**
 * A write was sent but its outcome is unknown (timeout or lost response). It may already be
 * committed, so it is never resent to another address without an idempotency contract.
 */
export class LanDeliveryUnknownError extends Error {
  constructor() {
    super('LAN delivery result is unknown');
    this.name = 'LanDeliveryUnknownError';
  }
}

function endpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/SyncClipboard.json`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function payloadEndpoint(baseUrl: string, name: string): string {
  validatePayloadName(name);
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/file/${name}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function healthEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/healthz`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function sseEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/api/sse/clipboard`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function validatePayloadName(name: string): void {
  if (!name || name.includes('/') || name.includes('\\')) {
    throw new Error('Invalid LAN payload name');
  }
}

export interface LanPutResult {
  url: string;
  /** The desktop's own id for what it stored from this upload, when its reply carries one. */
  contentId?: string;
}

function requestNotSent(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'ERR_REQUEST_NOT_SENT';
}

function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** Desktop hosts that assign content ids name the stored content in the upload reply. */
function ackContentId(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const contentId = (data as { contentId?: unknown }).contentId;
  return typeof contentId === 'string' && contentId.length > 0 ? contentId : undefined;
}

function authorizationHeaders(server: LanServerDraft): Record<string, string> {
  return {
    authorization: `Basic ${Base64.encode(`${server.username}:${server.password}`)}`,
  };
}

const defaultDependencies: LanHttpClientDependencies = {
  async uploadFile(sourceUri, url, headers) {
    return new File(sourceUri).upload(url, {
      httpMethod: 'PUT',
      headers,
    });
  },
  async downloadFile(url, destinationUri, headers) {
    const file = await File.downloadFileAsync(url, new File(destinationUri), {
      headers,
      idempotent: true,
    });
    return file.uri;
  },
  insecureTransport: new ReactNativeBlobLanTransport(),
  fetchStream: expoFetch,
  sendOnce: singleAttemptSender(),
};

const REQUEST_TIMEOUT_MS = 5000;
/** A payload stalled for this long in one connect, read or write step is abandoned. */
const PAYLOAD_STEP_TIMEOUT_MS = 30_000;
const SSE_CONNECT_TIMEOUT_MS = 10_000;
const SSE_HEARTBEAT_TIMEOUT_MS = 50_000;

function numberField(value: unknown, name: string): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const field = (value as Record<string, unknown>)[name];
  return typeof field === 'number' && Number.isFinite(field) ? field : undefined;
}

function stringField(value: unknown, name: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const field = (value as Record<string, unknown>)[name];
  return typeof field === 'string' && field.length > 0 ? field : undefined;
}

function parseSseMessage(message: EventSourceMessage): LanSseEvent | null {
  let data: unknown;
  try {
    data = message.data ? JSON.parse(message.data) : undefined;
  } catch {
    if (message.event !== 'resync') return null;
  }
  if (message.event === 'hello') {
    const serverTimeMs = numberField(data, 'server_time_ms');
    return serverTimeMs === undefined ? null : { type: 'hello', serverTimeMs };
  }
  if (message.event === 'update') {
    const contentId = stringField(data, 'content_id');
    const serverTimeMs = numberField(data, 'server_time_ms');
    return contentId === undefined || serverTimeMs === undefined
      ? null
      : { type: 'update', contentId, serverTimeMs };
  }
  if (message.event === 'resync') {
    return { type: 'resync', serverTimeMs: numberField(data, 'server_time_ms') };
  }
  return null;
}

function errorMessage(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

function isDocument(value: unknown): value is LanClipboardDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const doc = value as Record<string, unknown>;
  return (
    (doc.type === 'Text' || doc.type === 'Image' || doc.type === 'File' || doc.type === 'Group') &&
    typeof doc.text === 'string' &&
    typeof doc.hasData === 'boolean'
  );
}

type ReadOutcome =
  | { kind: 'document'; document: LanClipboardDocument }
  | { kind: 'empty' }
  | { kind: 'auth' }
  | { kind: 'invalid' }
  | { kind: 'transport' };

type HealthOutcome = 'reachable' | 'unknown' | 'transport';

interface Discovery {
  lease: RouteLease;
  /** The protected read that validated the route; null when the server reported no document (404). */
  document: LanClipboardDocument | null;
}

function abortError(): Error {
  const error = new Error('LAN request was cancelled');
  error.name = 'AbortError';
  return error;
}

/** Resolves with `promise`, or rejects as soon as `signal` aborts (the work itself is cancelled by its owner). */
function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

export class LanHttpClient {
  private readonly dependencies: LanHttpClientDependencies;
  private readonly routes: LanEndpointPool;
  /** One route discovery per server at a time, shared by reads, writes and the SSE subscription. */
  private readonly discoveries = new Map<string, Promise<Discovery>>();

  constructor(
    dependencies: Partial<LanHttpClientDependencies> = {},
    routes = new LanEndpointPool()
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
    this.routes = routes;
  }

  /** The device's network changed: forget verified routes and back-offs from the old network. */
  invalidateRoutes(): void {
    this.routes.invalidateAll();
    traceLan('routes_invalidated');
  }

  async getClipboard(
    server: LanServerDraft,
    signal?: AbortSignal
  ): Promise<{ document: LanClipboardDocument; url: string } | null> {
    const preferred = this.routes.preferred(server);
    if (preferred) {
      const outcome = await this.read(server, preferred, signal);
      if (outcome.kind === 'document') {
        this.routes.reportSuccess(preferred);
        return { document: outcome.document, url: preferred.url };
      }
      if (outcome.kind === 'auth') throw new LanAuthenticationError();
      if (outcome.kind === 'empty') return null;
      if (signal?.aborted) throw abortError();
      // The verified address stopped answering: rediscover now instead of waiting for the next poll.
      if (outcome.kind === 'transport') this.routes.reportTransportFailure(preferred);
      else this.routes.reportInvalid(preferred);
    }
    const discovery = await untilAborted(this.discover(server), signal);
    return discovery.document ? { document: discovery.document, url: discovery.lease.url } : null;
  }

  async putClipboard(
    server: LanServerDraft,
    document: LanClipboardDocument,
    payload?: LanPayloadUpload
  ): Promise<LanPutResult> {
    if (payload) validatePayloadName(payload.name);
    // A write goes to one verified address only; it never races or fails over.
    const lease = this.routes.preferred(server) ?? (await this.discover(server)).lease;
    const route = routeRole(server.urls, lease.url);
    const startedAt = performance.now();
    traceLan('put_attempt', {
      route,
      payload: Boolean(payload),
      cid: contentAlias(document.hash),
      transport: this.dependencies.sendOnce ? 'once' : 'default',
    });
    let sent = false;
    try {
      if (payload) {
        const response = await this.putPayload(server, lease.url, payload);
        if (response.status === 401) throw new LanAuthenticationError();
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`LAN payload upload failed with status ${response.status}`);
        }
      }
      sent = true;
      const response = await this.putDocument(server, lease.url, document);
      const contentId = ackContentId(response.data);
      traceLan('put_result', {
        route,
        status: response.status,
        ms: Math.round(performance.now() - startedAt),
        ack: contentId !== undefined,
      });
      if (response.status === 401) throw new LanAuthenticationError();
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`LAN clipboard upload failed with status ${response.status}`);
      }
      this.routes.reportSuccess(lease);
      return contentId === undefined ? { url: lease.url } : { url: lease.url, contentId };
    } catch (error) {
      if (error instanceof LanAuthenticationError) throw error;
      if (error instanceof Error && error.message.startsWith('LAN ')) throw error;
      // Only a request that may have left the device can have been committed.
      const committedMaybe = sent && !requestNotSent(error);
      traceLan('put_result', {
        route,
        status: committedMaybe ? 'unknown' : 'transport_error',
        ms: Math.round(performance.now() - startedAt),
      });
      this.routes.reportTransportFailure(lease);
      // The document request may have been committed before its response was lost.
      throw committedMaybe ? new LanDeliveryUnknownError() : new LanUnavailableError();
    }
  }

  private async putPayload(
    server: LanServerDraft,
    baseUrl: string,
    payload: LanPayloadUpload
  ): Promise<{ status: number }> {
    const url = payloadEndpoint(baseUrl, payload.name);
    const headers = {
      ...authorizationHeaders(server),
      'content-type': payload.mimeType ?? 'application/octet-stream',
    };
    const sendOnce = this.dependencies.sendOnce;
    if (sendOnce) {
      return sendOnce({
        method: 'PUT',
        url,
        headers,
        fileUri: payload.uri,
        timeoutMs: PAYLOAD_STEP_TIMEOUT_MS,
        trustAllCertificates: server.allowInsecureTls,
      });
    }
    return (
      server.allowInsecureTls ? this.dependencies.insecureTransport : this.dependencies
    ).uploadFile(payload.uri, url, headers);
  }

  private async putDocument(
    server: LanServerDraft,
    baseUrl: string,
    document: LanClipboardDocument
  ): Promise<{ status: number; data?: unknown }> {
    const sendOnce = this.dependencies.sendOnce;
    if (sendOnce) {
      const reply = await sendOnce({
        method: 'PUT',
        url: endpoint(baseUrl),
        headers: { ...authorizationHeaders(server), 'content-type': 'application/json' },
        text: JSON.stringify(document),
        timeoutMs: REQUEST_TIMEOUT_MS,
        trustAllCertificates: server.allowInsecureTls,
      });
      return { status: reply.status, data: parseJsonBody(reply.body) };
    }
    return server.allowInsecureTls
      ? this.dependencies.insecureTransport.putJson(
          endpoint(baseUrl),
          document,
          authorizationHeaders(server)
        )
      : axios.put(endpoint(baseUrl), document, {
          auth: { username: server.username, password: server.password },
          timeout: REQUEST_TIMEOUT_MS,
          validateStatus: () => true,
        });
  }

  async downloadPayload(
    server: LanServerDraft,
    baseUrl: string,
    name: string,
    destinationUri: string
  ): Promise<string> {
    validatePayloadName(name);
    return (
      server.allowInsecureTls ? this.dependencies.insecureTransport : this.dependencies
    ).downloadFile(payloadEndpoint(baseUrl, name), destinationUri, authorizationHeaders(server));
  }

  subscribeClipboardEvents(server: LanServerDraft, listener: LanSseListener): () => void {
    const subscriptionController = new AbortController();
    void this.runSseSubscription(server, listener, subscriptionController.signal);
    return () => subscriptionController.abort();
  }

  private discover(server: LanServerDraft): Promise<Discovery> {
    const key = lanServerKey(server);
    const existing = this.discoveries.get(key);
    if (existing) return existing;
    const discovery = this.runDiscovery(server).finally(() => {
      if (this.discoveries.get(key) === discovery) this.discoveries.delete(key);
    });
    this.discoveries.set(key, discovery);
    return discovery;
  }

  /**
   * Probes every candidate's public health route in parallel, then validates reachable candidates
   * with one protected read each, in the order they answered. The first valid document wins and
   * cancels the remaining probes. A public 204 only earns a protected read; it never selects a
   * route by itself, and protected reads never run in parallel (each costs the server a password
   * hash).
   */
  private async runDiscovery(server: LanServerDraft): Promise<Discovery> {
    const plan = this.routes.discoveryPlan(server);
    if (plan.leases.length === 0) throw new LanUnavailableError();
    if (plan.waitMs > 0) {
      // Every address is backing off: do not touch the network before the earliest retry.
      traceLan('discovery_backoff', { waitMs: plan.waitMs });
      throw new LanUnavailableError();
    }
    const controller = new AbortController();
    const startedAt = performance.now();
    traceLan('discovery_start', { candidates: plan.leases.length });
    const probes = plan.leases.map((lease, index) =>
      this.probeHealth(server, lease, controller.signal).then((health) => ({
        index,
        lease,
        health,
      }))
    );
    const pending = new Map(probes.map((probe, index) => [index, probe]));
    let sawAuth = false;
    let sawEmpty: RouteLease | null = null;
    try {
      while (pending.size > 0) {
        const { index, lease, health } = await Promise.race(pending.values());
        pending.delete(index);
        if (!this.routes.isCurrent(lease)) continue;
        if (health === 'transport') {
          this.routes.reportTransportFailure(lease);
          continue;
        }
        const outcome = await this.read(server, lease, controller.signal);
        if (outcome.kind === 'document') {
          this.routes.reportSuccess(lease);
          traceLan('discovery_done', {
            route: routeRole(server.urls, lease.url),
            ms: Math.round(performance.now() - startedAt),
          });
          return { lease, document: outcome.document };
        }
        if (outcome.kind === 'auth') sawAuth = true;
        else if (outcome.kind === 'empty') sawEmpty ??= lease;
        else if (outcome.kind === 'transport') this.routes.reportTransportFailure(lease);
        else this.routes.reportInvalid(lease);
      }
    } finally {
      controller.abort();
    }
    traceLan('discovery_failed', {
      auth: sawAuth,
      empty: Boolean(sawEmpty),
      ms: Math.round(performance.now() - startedAt),
    });
    if (sawEmpty) return { lease: sawEmpty, document: null };
    if (sawAuth) throw new LanAuthenticationError();
    throw new LanUnavailableError();
  }

  private async probeHealth(
    server: LanServerDraft,
    lease: RouteLease,
    signal: AbortSignal
  ): Promise<HealthOutcome> {
    const route = routeRole(server.urls, lease.url);
    const startedAt = performance.now();
    let outcome: HealthOutcome;
    try {
      const response = server.allowInsecureTls
        ? await this.dependencies.insecureTransport.getJson(healthEndpoint(lease.url), {}, signal)
        : await axios.get(healthEndpoint(lease.url), {
            timeout: REQUEST_TIMEOUT_MS,
            signal,
            responseType: 'text',
            transformResponse: [(body) => body],
            validateStatus: () => true,
          });
      // 204 is the listener's liveness answer; any other HTTP reply (an older server without the
      // route, a portal page) only proves something answers, so it still needs a protected read.
      outcome = response.status === 204 ? 'reachable' : 'unknown';
      traceLan('health_result', {
        route,
        status: response.status,
        ms: Math.round(performance.now() - startedAt),
      });
    } catch {
      outcome = 'transport';
      if (!signal.aborted) {
        traceLan('health_result', {
          route,
          status: 'transport_error',
          ms: Math.round(performance.now() - startedAt),
        });
      }
    }
    return outcome;
  }

  private async read(
    server: LanServerDraft,
    lease: RouteLease,
    signal?: AbortSignal
  ): Promise<ReadOutcome> {
    const route = routeRole(server.urls, lease.url);
    const startedAt = performance.now();
    traceLan('get_attempt', { route, gen: lease.generation });
    try {
      const response = server.allowInsecureTls
        ? await this.dependencies.insecureTransport.getJson(
            endpoint(lease.url),
            authorizationHeaders(server),
            signal
          )
        : await axios.get(endpoint(lease.url), {
            auth: { username: server.username, password: server.password },
            timeout: REQUEST_TIMEOUT_MS,
            signal,
            validateStatus: () => true,
          });
      const valid = response.status >= 200 && response.status < 300 && isDocument(response.data);
      traceLan('get_result', {
        route,
        status: response.status,
        valid,
        ms: Math.round(performance.now() - startedAt),
        cid: valid ? contentAlias((response.data as LanClipboardDocument).contentId) : undefined,
      });
      if (valid)
        return {
          kind: 'document',
          document: response.data as LanClipboardDocument,
        };
      if (response.status === 401) return { kind: 'auth' };
      if (response.status === 404) return { kind: 'empty' };
      return { kind: 'invalid' };
    } catch {
      traceLan('get_result', {
        route,
        status: signal?.aborted ? 'cancelled' : 'transport_error',
        ms: Math.round(performance.now() - startedAt),
      });
      return { kind: 'transport' };
    }
  }

  private async runSseSubscription(
    server: LanServerDraft,
    listener: LanSseListener,
    subscriptionSignal: AbortSignal
  ): Promise<void> {
    let lease: RouteLease;
    try {
      lease = this.routes.preferred(server) ?? (await this.discover(server)).lease;
    } catch (error) {
      if (!subscriptionSignal.aborted) {
        const failure = errorMessage(error, 'LAN SSE route is unavailable');
        traceLan('sse_disconnected', { error: failure.name });
        listener.onDisconnected(failure);
      }
      return;
    }
    if (subscriptionSignal.aborted) return;
    const route = routeRole(server.urls, lease.url);
    traceLan('sse_attempt', { route, gen: lease.generation });
    const requestController = new AbortController();
    const abortRequest = () => requestController.abort();
    subscriptionSignal.addEventListener('abort', abortRequest, { once: true });
    // Deadlines run on the native timer: JS timers stop while the Android activity is paused.
    let cancelDeadline = scheduleOnce(abortRequest, SSE_CONNECT_TIMEOUT_MS);
    let helloReceived = false;
    let failure: Error = new LanUnavailableError();
    try {
      const response = await this.dependencies.fetchStream(sseEndpoint(lease.url), {
        headers: {
          ...authorizationHeaders(server),
          accept: 'text/event-stream',
        },
        signal: requestController.signal,
      });
      if (response.status === 401) throw new LanAuthenticationError();
      if (!response.ok || !response.body) {
        this.routes.reportInvalid(lease);
        throw new Error(`LAN SSE request failed with status ${response.status}`);
      }
      // The response headers arrived; the heartbeat deadline now guards the stream instead.
      cancelDeadline();
      cancelDeadline = scheduleOnce(abortRequest, SSE_HEARTBEAT_TIMEOUT_MS);

      const decoder = new TextDecoder();
      const parser = createParser({
        onEvent: (message) => {
          const event = parseSseMessage(message);
          if (!event || subscriptionSignal.aborted) return;
          if (event.type === 'hello' && !helloReceived) {
            helloReceived = true;
            // A valid hello proves the protected route; it is as good as a protected read.
            this.routes.reportSuccess(lease);
          }
          traceLan('sse_event', {
            route,
            type: event.type,
            cid: event.type === 'update' ? contentAlias(event.contentId) : undefined,
            server: event.serverTimeMs,
          });
          listener.onEvent(event);
        },
      });
      const reader = response.body.getReader();
      while (!subscriptionSignal.aborted) {
        const { done, value } = await reader.read();
        cancelDeadline();
        if (done) break;
        cancelDeadline = scheduleOnce(abortRequest, SSE_HEARTBEAT_TIMEOUT_MS);
        if (value) parser.feed(decoder.decode(value, { stream: true }));
      }
      if (subscriptionSignal.aborted) return;
      parser.feed(decoder.decode());
      failure = new Error('LAN SSE stream ended');
    } catch (error) {
      if (subscriptionSignal.aborted) return;
      failure = errorMessage(error, 'LAN SSE connection failed');
      // A stream that never said hello failed at the transport level; a healthy stream that
      // dropped keeps its route, so the next attempt reconnects to the same address.
      if (!helloReceived && !(failure instanceof LanAuthenticationError)) {
        this.routes.reportTransportFailure(lease);
      }
    } finally {
      cancelDeadline();
      subscriptionSignal.removeEventListener('abort', abortRequest);
    }
    if (!subscriptionSignal.aborted) {
      traceLan('sse_disconnected', {
        route,
        error: failure.name,
        hello: helloReceived,
      });
      listener.onDisconnected(failure);
    }
  }
}
