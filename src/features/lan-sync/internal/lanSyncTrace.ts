import { createLogger } from '@/support/observability';

const log = createLogger('LanSyncTrace');

type TraceValue = string | number | boolean | null | undefined;

/**
 * Short, stable alias of an opaque content identity (FNV-1a 32-bit). The identity is already a
 * content hash; the alias only lets one copy be followed across the desktop and phone timelines.
 */
export function contentAlias(contentId: string | undefined): string {
  if (!contentId) return 'none';
  let hash = 0x811c9dc5;
  for (let index = 0; index < contentId.length; index += 1) {
    hash ^= contentId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Candidate role by configured position; never the address itself. */
export function routeRole(urls: readonly string[], url: string): string {
  const index = urls.indexOf(url);
  return index >= 0 ? `c${index}` : 'c?';
}

/**
 * One LAN sync stage. `wall` and `mono` are read when the stage happens, so the asynchronous log
 * writer does not shift the recorded time. Fields carry roles, aliases, durations and outcomes
 * only: no clipboard text, address, credential or header.
 */
export function traceLan(stage: string, fields: Record<string, TraceValue> = {}): void {
  const parts = [`stage=${stage}`, `wall=${Date.now()}`, `mono=${Math.round(performance.now())}`];
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) parts.push(`${key}=${value}`);
  }
  log.info(`lan.trace ${parts.join(' ')}`);
}
