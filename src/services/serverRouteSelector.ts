import type { ServerConfig } from '@/types/api';
import { AuthenticationError, NetworkError, ServerError, TimeoutError } from './errors';
import { classifyURL } from '@/utils/classifyUrl';

export interface NetworkContext {
  isWifi: boolean;
  isCellular: boolean;
  isTailscale: boolean;
  ssid?: string | null;
}

export interface RouteRecordStore {
  loadLiveUrl: (serverKey: string) => string | null | Promise<string | null>;
  saveLiveUrl: (serverKey: string, url: string | null) => void | Promise<void>;
}

export interface RouteSelectionOptions extends RouteRecordStore {
  network: NetworkContext;
  probeRoute?: (route: ServerRoute, signal?: AbortSignal) => Promise<void>;
  probeTimeoutMs?: number;
}

export interface ServerRoute {
  server: ServerConfig;
  serverKey: string;
  url: string;
  index: number;
}

export interface RouteSelectionResult<T> {
  result: T;
  url: string;
  attempts: string[];
}

const DEFAULT_ROUTE_PROBE_TIMEOUT_MS = 1000;

export function normalizeServerUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/+$/, '');
  } catch {
    return trimmed.replace(/\/+$/, '') || null;
  }
}

export function getServerRouteKey(server: ServerConfig): string {
  const urls = getEffectiveServerUrls(server);
  return urls[0] ?? server.url;
}

export function getEffectiveServerUrls(server: ServerConfig): string[] {
  const candidates = server.urls && server.urls.length > 0 ? server.urls : [server.url];
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const candidate of candidates) {
    const normalized = normalizeServerUrl(candidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
  }

  return urls;
}

export function orderServerUrls(
  server: ServerConfig,
  network: NetworkContext,
  options: { liveUrl?: string | null } = {}
): string[] {
  const urls = getEffectiveServerUrls(server);
  const preference = getClassPreference(network);
  const ordered = preference
    ? urls
        .map((url, index) => ({ url, index, rank: rankUrl(url, preference) }))
        .sort((a, b) => (a.rank === b.rank ? a.index - b.index : a.rank - b.rank))
        .map((entry) => entry.url)
    : urls;

  const liveUrl = options.liveUrl ? normalizeServerUrl(options.liveUrl) : null;
  if (!liveUrl || !urls.includes(liveUrl)) return ordered;
  if (!shouldPromoteLiveUrl(liveUrl, ordered, preference)) return ordered;

  return [liveUrl, ...ordered.filter((url) => url !== liveUrl)];
}

export async function selectServerUrl<T>(
  server: ServerConfig,
  options: RouteSelectionOptions,
  operation: (route: ServerRoute) => Promise<T>
): Promise<RouteSelectionResult<T>> {
  const serverKey = getServerRouteKey(server);
  const liveUrl = await options.loadLiveUrl(serverKey);
  const orderedUrls = orderServerUrls(server, options.network, { liveUrl });
  const healthyRoutes = await selectHealthyRoutes(server, serverKey, orderedUrls, options);
  const routeUrls = healthyRoutes ? healthyRoutes.map((route) => route.url) : orderedUrls;
  if (healthyRoutes && routeUrls.length === 0) {
    await options.saveLiveUrl(serverKey, null);
    throw new NetworkError('No reachable server address');
  }
  const attempts: string[] = [];
  let lastRetryableError: unknown = null;

  for (const [index, url] of routeUrls.entries()) {
    attempts.push(url);
    try {
      const result = await operation({
        server: {
          ...server,
          url,
          urls: [url, ...orderedUrls.filter((candidate) => candidate !== url)],
        },
        serverKey,
        url,
        index,
      });
      await options.saveLiveUrl(serverKey, url);
      return { result, url, attempts };
    } catch (error) {
      if (!isRetryableRouteError(error)) {
        throw error;
      }
      lastRetryableError = error;
    }
  }

  await options.saveLiveUrl(serverKey, null);
  throw lastRetryableError ?? new NetworkError('No reachable server address');
}

async function selectHealthyRoutes(
  server: ServerConfig,
  serverKey: string,
  orderedUrls: string[],
  options: RouteSelectionOptions
): Promise<HealthyServerRoute[] | null> {
  if (!options.probeRoute || orderedUrls.length <= 1) return null;

  const timeoutMs = options.probeTimeoutMs ?? DEFAULT_ROUTE_PROBE_TIMEOUT_MS;
  const probeTasks = orderedUrls.map((url, index) =>
    createProbeTask(
      {
        server: {
          ...server,
          url,
          urls: [url, ...orderedUrls.filter((candidate) => candidate !== url)],
        },
        serverKey,
        url,
        index,
      },
      options.probeRoute!,
      timeoutMs
    )
  );

  const results = await Promise.allSettled(probeTasks.map((task) => task.promise));
  for (const task of probeTasks) task.abort();

  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason);
  const nonRetryable = failures.find(
    (failure) => failure instanceof RouteProbeError && !isRetryableRouteError(failure.error)
  );
  if (nonRetryable instanceof RouteProbeError) {
    throw nonRetryable.error;
  }

  return results
    .filter(
      (result): result is PromiseFulfilledResult<HealthyServerRoute> =>
        result.status === 'fulfilled'
    )
    .map((result) => result.value)
    .sort((a, b) =>
      a.milliseconds === b.milliseconds ? a.index - b.index : a.milliseconds - b.milliseconds
    );
}

function createProbeTask(
  route: ServerRoute,
  probeRoute: (route: ServerRoute, signal?: AbortSignal) => Promise<void>,
  timeoutMs: number
): { route: ServerRoute; promise: Promise<HealthyServerRoute>; abort: () => void } {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const started = Date.now();
  const clearProbeTimeout = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError('Route probe timeout'));
    }, timeoutMs);
  });

  const promise = Promise.race([probeRoute(route, controller.signal), timeoutPromise])
    .then(() => ({ ...route, milliseconds: Date.now() - started }))
    .catch((error) => {
      throw new RouteProbeError(route, error);
    })
    .finally(() => {
      clearProbeTimeout();
    });

  return {
    route,
    promise,
    abort: () => {
      clearProbeTimeout();
      controller.abort();
    },
  };
}

class RouteProbeError extends Error {
  constructor(
    readonly route: ServerRoute,
    readonly error: unknown
  ) {
    super(error instanceof Error ? error.message : 'Route probe failed');
    this.name = 'RouteProbeError';
  }
}

interface HealthyServerRoute extends ServerRoute {
  milliseconds: number;
}

export function createRoutedOperation<TClient>(
  server: ServerConfig,
  options: RouteSelectionOptions,
  createClient: (route: ServerRoute) => TClient
) {
  return {
    async call<K extends MethodKeys<TClient>>(
      method: K,
      ...args: MethodArgs<TClient[K]>
    ): Promise<MethodReturn<TClient[K]>> {
      const selected = await selectServerUrl(server, options, async (route) => {
        const client = createClient(route);
        const fn = client[method];
        if (typeof fn !== 'function') {
          throw new Error(`Route client method is not callable: ${String(method)}`);
        }
        return fn.apply(client, args);
      });
      return selected.result as MethodReturn<TClient[K]>;
    },
  };
}

type ClientMethod = (...args: never[]) => unknown;

type MethodKeys<T> = {
  [K in keyof T]: T[K] extends ClientMethod ? K : never;
}[keyof T];

type MethodArgs<T> = T extends (...args: infer A) => unknown ? A : never;

type MethodReturn<T> = Awaited<ReturnType<Extract<T, ClientMethod>>>;

function getClassPreference(network: NetworkContext) {
  const onWifi = network.isWifi || !!network.ssid;
  if (onWifi) return ['lan', 'tailscale', 'wan'] as const;
  if (network.isTailscale) return ['tailscale', 'wan', 'lan'] as const;
  if (network.isCellular) return ['wan', 'tailscale', 'lan'] as const;
  return null;
}

function rankUrl(url: string, preference: readonly string[]): number {
  const index = preference.indexOf(classifyURL(url));
  return index === -1 ? preference.length : index;
}

function shouldPromoteLiveUrl(
  liveUrl: string,
  orderedUrls: string[],
  preference: readonly string[] | null
): boolean {
  if (!preference || orderedUrls.length === 0) return true;
  const bestRank = rankUrl(orderedUrls[0], preference);
  return rankUrl(liveUrl, preference) <= bestRank;
}

function isRetryableRouteError(error: unknown): boolean {
  if (error instanceof AuthenticationError) return false;
  if (error instanceof TimeoutError || error instanceof NetworkError) return true;
  if (error instanceof ServerError) return false;

  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('connection') ||
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('offline')
  );
}
