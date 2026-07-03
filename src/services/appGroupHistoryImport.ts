import { Platform } from 'react-native';
import { getLegacyHistory, getPayloadFileUri, migrateLegacyContainer } from 'app-group-store';
import { ClipboardItem, HistorySyncStatus } from '../types/clipboard';
import { log } from './Logger';

const APPLE_REFERENCE_UNIX_MS = 978307200000;

type NativeHistoryItem = {
  entry?: {
    type?: ClipboardItem['type'];
    hash?: string | null;
    text?: string;
    hasData?: boolean;
    dataName?: string;
    size?: number;
  };
  timestamp?: number | string;
  direction?: 'pulled' | 'pushed' | 'local';
};

export async function importHistoryFromAppGroup(
  existingItems: ClipboardItem[]
): Promise<ClipboardItem[]> {
  if (Platform.OS !== 'ios') return [];

  try {
    await migrateLegacyContainer();
    const json = await getLegacyHistory();
    if (!json) return [];

    const parsed = JSON.parse(json) as NativeHistoryItem[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [];

    const existingHashes = new Set(existingItems.map((item) => item.profileHash.toLowerCase()));
    const imported: ClipboardItem[] = [];

    for (const item of parsed) {
      const mapped = await mapNativeHistoryItem(item);
      if (!mapped) continue;

      const key = mapped.profileHash.toLowerCase();
      if (existingHashes.has(key)) continue;

      existingHashes.add(key);
      imported.push(mapped);
    }

    return imported;
  } catch (error) {
    log.warn('[AppGroupHistoryImport] failed:', error);
    return [];
  }
}

export async function repairAppGroupHistoryPayloadUris(
  items: ClipboardItem[]
): Promise<{ items: ClipboardItem[]; repaired: number }> {
  if (Platform.OS !== 'ios') return { items, repaired: 0 };

  try {
    await migrateLegacyContainer();
  } catch (error) {
    log.warn('[AppGroupHistoryImport] legacy payload migration failed:', error);
  }

  let repaired = 0;
  const nextItems: ClipboardItem[] = [];

  for (const item of items) {
    if (!item.hasData || !item.profileHash || !['Image', 'File'].includes(item.type)) {
      nextItems.push(item);
      continue;
    }

    const profileId = `${item.type}-${item.profileHash}`;
    const fileUri = await getPayloadFileUri(profileId);
    if (!fileUri || (item.fileUri === fileUri && item.isLocalFileReady !== false)) {
      nextItems.push(item);
      continue;
    }

    repaired += 1;
    nextItems.push({
      ...item,
      fileUri,
      isLocalFileReady: true,
      hasRemoteData: item.hasRemoteData ?? true,
    });
  }

  return { items: repaired > 0 ? nextItems : items, repaired };
}

async function mapNativeHistoryItem(item: NativeHistoryItem): Promise<ClipboardItem | null> {
  const entry = item.entry;
  const profileHash = entry?.hash?.trim();
  if (!entry?.type || !profileHash) return null;

  const timestamp = parseNativeTimestamp(item.timestamp);
  const profileId = `${entry.type}-${profileHash}`;
  const fileUri = entry.hasData ? await getPayloadFileUri(profileId) : null;
  const isPulled = item.direction === 'pulled';
  const isLocal = item.direction === 'local';

  return {
    type: entry.type,
    text: entry.text ?? '',
    profileHash,
    hasData: entry.hasData ?? false,
    dataName: entry.dataName,
    size: entry.size ?? 0,
    timestamp,
    starred: false,
    useCount: 0,
    fileUri: fileUri ?? undefined,
    syncStatus: isLocal ? HistorySyncStatus.LocalOnly : HistorySyncStatus.Synced,
    version: 0,
    lastModified: timestamp,
    lastAccessed: timestamp,
    isDeleted: false,
    pinned: false,
    isLocalFileReady: entry.hasData ? !!fileUri : true,
    from: isPulled ? 'server' : undefined,
    hasRemoteData: entry.hasData ?? false,
  };
}

function parseNativeTimestamp(value: NativeHistoryItem['timestamp']): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10000000000 ? Math.round(value * 1000 + APPLE_REFERENCE_UNIX_MS) : value;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return Date.now();
}
