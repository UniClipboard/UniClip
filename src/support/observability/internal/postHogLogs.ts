import type PostHog from 'posthog-react-native';
import type { LogLevel } from './logger';

type LogRecord = Parameters<PostHog['captureLog']>[0];

// Remote diagnostics accept reviewed literals only. Local logs retain their detail.
const MESSAGES: Readonly<Record<string, readonly string[]>> = {
  UnifiedSpaceService: ['Join space failed', 'Space refresh failed', 'Failed to remove a space member'],
  UnifiedEngineService: [
    'Failed to stop the P2P engine:', 'Failed to start the P2P engine:',
    'Failed to read a P2P engine event:', 'A P2P event subscriber failed:',
    'The P2P engine reported a fatal failure:', 'Peer recovery refresh failed:',
  ],
  P2pSyncAdapter: [
    'P2P space state', 'P2P receiver recovery finished', 'Failed to recover P2P peer connections:',
    'Failed to refresh space after a device trust event:',
    'Failed to refresh devices after an engine event:',
  ],
  ClipboardSyncObserver: ['Clipboard observation failed; kept local:'],
  ClipboardMonitor: [
    'Stopped monitoring', 'Pasteboard read denied by user; pausing reads until changeCount changes',
    'Failed to check clipboard:', 'Event monitor unavailable, falling back to polling:',
    'Failed to handle clipboard event:', 'Callback error:',
  ],
  ClipboardManager: [
    'Failed to get image:', 'Failed to get clipboard content:', 'Failed to save text to file:',
    'Failed to set text content:', 'Failed to set image content:', 'Failed to set file content:',
    'Failed to clear clipboard:', 'Failed to check clipboard change:',
  ],
};
const COUNTS = new Set(['deviceCount', 'total', 'online', 'offline', 'errors']);
const STAGES = new Set(['prepareP2p', 'requestJoin', 'refreshDevices', 'querySpaceState', 'listDevices', 'queryDeviceTrust']);

function safeAttributes(value: unknown): NonNullable<LogRecord['attributes']> {
  const attributes: NonNullable<LogRecord['attributes']> = {};
  if (!value || typeof value !== 'object') return attributes;
  for (const [key, field] of Object.entries(value)) {
    if (COUNTS.has(key) && typeof field === 'number' && Number.isSafeInteger(field) && field >= 0 && field <= 1_000_000) {
      attributes[key] = field;
    } else if ((key === 'errorCode' || key === 'code') && typeof field === 'number' && Number.isInteger(field) && field >= 1000 && field <= 9999) {
      attributes.errorCode = field;
    } else if (key === 'hadExistingSpace' && typeof field === 'boolean') {
      attributes[key] = field;
    } else if (key === 'stage' && typeof field === 'string' && STAGES.has(field)) {
      attributes[key] = field;
    }
  }
  return attributes;
}

export function filterPostHogLog(record: LogRecord): LogRecord | null {
  const source = record.attributes?.source;
  if (typeof source !== 'string' || !Object.hasOwn(MESSAGES, source) || !MESSAGES[source].includes(record.body)) return null;
  if (record.level !== 'info' && record.level !== 'warn' && record.level !== 'error') return null;
  return { body: record.body, level: record.level, attributes: { source, ...safeAttributes(record.attributes) } };
}

export function createPostHogLog(level: LogLevel, source: string, args: unknown[]): LogRecord | null {
  if (typeof args[0] !== 'string') return null;
  return filterPostHogLog({ body: args[0], level, attributes: { ...safeAttributes(args[1]), source } });
}
