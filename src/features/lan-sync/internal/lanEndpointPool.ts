import type { LanServerDraft } from '@/features/lan-servers';

/**
 * In-memory route state for one configured LAN server: which candidate address last answered a
 * protected request, which candidates are backing off after transport failures, and the
 * generation that invalidates in-flight results after a configuration or network change.
 *
 * Nothing is persisted and no credential is stored: the server key carries only a hash of the
 * password so that a credential change starts a new route state.
 */
export interface RouteLease {
  serverKey: string;
  url: string;
  generation: number;
}

interface EndpointState {
  failureCount: number;
  retryAtMs: number;
  lastSuccessMs: number | null;
}

interface ServerRoutes {
  generation: number;
  preferredUrl: string | null;
  endpoints: Map<string, EndpointState>;
}

const BACKOFF_STEPS_MS = [1000, 2000, 4000, 8000, 16000, 30000];

function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function lanServerKey(server: LanServerDraft): string {
  return JSON.stringify([
    server.urls.map(normalizeUrl),
    server.username,
    hashText(server.password),
    server.allowInsecureTls,
  ]);
}

export interface LanEndpointPoolClock {
  now(): number;
  random(): number;
}

export class LanEndpointPool {
  private readonly servers = new Map<string, ServerRoutes>();
  private networkGeneration = 0;

  constructor(
    private readonly clock: LanEndpointPoolClock = {
      now: () => Date.now(),
      random: Math.random,
    }
  ) {}

  private routes(serverKey: string): ServerRoutes {
    let routes = this.servers.get(serverKey);
    if (!routes) {
      routes = {
        generation: this.networkGeneration,
        preferredUrl: null,
        endpoints: new Map(),
      };
      this.servers.set(serverKey, routes);
    }
    return routes;
  }

  private endpoint(routes: ServerRoutes, url: string): EndpointState {
    let state = routes.endpoints.get(url);
    if (!state) {
      state = { failureCount: 0, retryAtMs: 0, lastSuccessMs: null };
      routes.endpoints.set(url, state);
    }
    return state;
  }

  private current(lease: RouteLease): ServerRoutes | null {
    const routes = this.servers.get(lease.serverKey);
    return routes && routes.generation === lease.generation ? routes : null;
  }

  /** The verified address to use directly, if one exists for this server and generation. */
  preferred(server: LanServerDraft): RouteLease | null {
    const serverKey = lanServerKey(server);
    const routes = this.routes(serverKey);
    if (!routes.preferredUrl) return null;
    return {
      serverKey,
      url: routes.preferredUrl,
      generation: routes.generation,
    };
  }

  /**
   * Candidates for a fresh route discovery, in configured order, without duplicates. Candidates
   * still backing off are skipped; when every candidate is backing off, the earliest one to
   * expire is returned with its remaining wait so callers never spin.
   */
  discoveryPlan(server: LanServerDraft): {
    leases: RouteLease[];
    waitMs: number;
  } {
    const serverKey = lanServerKey(server);
    const routes = this.routes(serverKey);
    const urls = [...new Set(server.urls.map(normalizeUrl).filter(Boolean))];
    const now = this.clock.now();
    const ready = urls.filter((url) => this.endpoint(routes, url).retryAtMs <= now);
    const lease = (url: string): RouteLease => ({
      serverKey,
      url,
      generation: routes.generation,
    });
    if (ready.length > 0 || urls.length === 0) return { leases: ready.map(lease), waitMs: 0 };
    const earliest = urls.reduce((best, url) =>
      this.endpoint(routes, url).retryAtMs < this.endpoint(routes, best).retryAtMs ? url : best
    );
    return {
      leases: [lease(earliest)],
      waitMs: Math.max(0, this.endpoint(routes, earliest).retryAtMs - now),
    };
  }

  /** A protected request (or SSE hello) succeeded at this address: it becomes the preferred route. */
  reportSuccess(lease: RouteLease): void {
    const routes = this.current(lease);
    if (!routes) return;
    const state = this.endpoint(routes, lease.url);
    state.failureCount = 0;
    state.retryAtMs = 0;
    state.lastSuccessMs = this.clock.now();
    routes.preferredUrl = lease.url;
  }

  /** The address could not be reached: back it off and stop preferring it. */
  reportTransportFailure(lease: RouteLease): void {
    const routes = this.current(lease);
    if (!routes) return;
    const state = this.endpoint(routes, lease.url);
    const step = BACKOFF_STEPS_MS[Math.min(state.failureCount, BACKOFF_STEPS_MS.length - 1)];
    state.failureCount += 1;
    state.retryAtMs = this.clock.now() + step + Math.floor(this.clock.random() * step * 0.2);
    if (routes.preferredUrl === lease.url) routes.preferredUrl = null;
  }

  /** The address answered but is not the server (wrong service, malformed reply): never prefer it. */
  reportInvalid(lease: RouteLease): void {
    this.reportTransportFailure(lease);
  }

  isCurrent(lease: RouteLease): boolean {
    return this.current(lease) !== null;
  }

  /** The device's network changed: every route and back-off belongs to the old network. */
  invalidateAll(): void {
    this.networkGeneration += 1;
    this.servers.clear();
  }
}
