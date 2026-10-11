import axios from 'axios';
import { fetch as expoFetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import { createParser, type EventSourceMessage } from 'eventsource-parser';
import { Base64 } from 'js-base64';
import type { LanServerDraft } from '@/features/lan-servers';
import {
  ReactNativeBlobLanTransport,
  type LanInsecureHttpTransport,
} from './lanInsecureHttpTransport';
import { contentAlias, routeRole, traceLan } from './lanSyncTrace';

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
};

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

export class LanHttpClient {
  private readonly dependencies: LanHttpClientDependencies;

  constructor(dependencies: Partial<LanHttpClientDependencies> = {}) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async getClipboard(
    server: LanServerDraft
  ): Promise<{ document: LanClipboardDocument; url: string } | null> {
    for (const baseUrl of server.urls) {
      const route = routeRole(server.urls, baseUrl);
      const startedAt = performance.now();
      traceLan('get_attempt', { route });
      try {
        const response = server.allowInsecureTls
          ? await this.dependencies.insecureTransport.getJson(
              endpoint(baseUrl),
              authorizationHeaders(server)
            )
          : await axios.get(endpoint(baseUrl), {
              auth: { username: server.username, password: server.password },
              timeout: 5000,
              validateStatus: () => true,
            });
        const valid =
          response.status >= 200 && response.status < 300 && isDocument(response.data);
        traceLan('get_result', {
          route,
          status: response.status,
          valid,
          ms: Math.round(performance.now() - startedAt),
          cid: valid ? contentAlias((response.data as LanClipboardDocument).contentId) : undefined,
        });
        if (response.status === 401) throw new LanAuthenticationError();
        if (response.status === 404) return null;
        if (!valid) continue;
        return { document: response.data as LanClipboardDocument, url: baseUrl };
      } catch (error) {
        if (error instanceof LanAuthenticationError) throw error;
        traceLan('get_result', {
          route,
          status: 'transport_error',
          ms: Math.round(performance.now() - startedAt),
        });
      }
    }
    throw new LanUnavailableError();
  }

  async putClipboard(
    server: LanServerDraft,
    document: LanClipboardDocument,
    payload?: LanPayloadUpload
  ): Promise<{ url: string }> {
    if (payload) validatePayloadName(payload.name);
    for (const baseUrl of server.urls) {
      try {
        if (payload) {
          const response = await (server.allowInsecureTls
            ? this.dependencies.insecureTransport
            : this.dependencies
          ).uploadFile(payload.uri, payloadEndpoint(baseUrl, payload.name), {
            ...authorizationHeaders(server),
            'content-type': payload.mimeType ?? 'application/octet-stream',
          });
          if (response.status === 401) throw new LanAuthenticationError();
          if (response.status < 200 || response.status >= 300) continue;
        }
        const response = server.allowInsecureTls
          ? await this.dependencies.insecureTransport.putJson(
              endpoint(baseUrl),
              document,
              authorizationHeaders(server)
            )
          : await axios.put(endpoint(baseUrl), document, {
              auth: { username: server.username, password: server.password },
              timeout: 5000,
              validateStatus: () => true,
            });
        if (response.status === 401) throw new LanAuthenticationError();
        if (response.status >= 200 && response.status < 300) return { url: baseUrl };
      } catch (error) {
        if (error instanceof LanAuthenticationError) throw error;
      }
    }
    throw new LanUnavailableError();
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

  private async runSseSubscription(
    server: LanServerDraft,
    listener: LanSseListener,
    subscriptionSignal: AbortSignal
  ): Promise<void> {
    let lastError: Error = new LanUnavailableError();
    for (const baseUrl of server.urls) {
      if (subscriptionSignal.aborted) return;
      const route = routeRole(server.urls, baseUrl);
      traceLan('sse_attempt', { route });
      const requestController = new AbortController();
      const abortRequest = () => requestController.abort();
      subscriptionSignal.addEventListener('abort', abortRequest, { once: true });
      let timeout = setTimeout(abortRequest, SSE_CONNECT_TIMEOUT_MS);
      try {
        const response = await this.dependencies.fetchStream(sseEndpoint(baseUrl), {
          headers: {
            ...authorizationHeaders(server),
            accept: 'text/event-stream',
          },
          signal: requestController.signal,
        });
        clearTimeout(timeout);
        if (response.status === 401) throw new LanAuthenticationError();
        if (!response.ok || !response.body) {
          lastError = new Error(`LAN SSE request failed with status ${response.status}`);
          continue;
        }

        const decoder = new TextDecoder();
        const parser = createParser({
          onEvent: (message) => {
            const event = parseSseMessage(message);
            if (event && !subscriptionSignal.aborted) {
              traceLan('sse_event', {
                route,
                type: event.type,
                cid: event.type === 'update' ? contentAlias(event.contentId) : undefined,
                server: event.serverTimeMs,
              });
              listener.onEvent(event);
            }
          },
        });
        const reader = response.body.getReader();
        while (!subscriptionSignal.aborted) {
          timeout = setTimeout(abortRequest, SSE_HEARTBEAT_TIMEOUT_MS);
          const { done, value } = await reader.read();
          clearTimeout(timeout);
          if (done) break;
          if (value) parser.feed(decoder.decode(value, { stream: true }));
        }
        if (subscriptionSignal.aborted) return;
        parser.feed(decoder.decode());
        lastError = new Error('LAN SSE stream ended');
      } catch (error) {
        if (subscriptionSignal.aborted) return;
        lastError = errorMessage(error, 'LAN SSE connection failed');
        if (lastError instanceof LanAuthenticationError) break;
      } finally {
        clearTimeout(timeout);
        subscriptionSignal.removeEventListener('abort', abortRequest);
      }
    }
    if (!subscriptionSignal.aborted) {
      traceLan('sse_disconnected', { error: lastError.name });
      listener.onDisconnected(lastError);
    }
  }
}
