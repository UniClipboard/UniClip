import { ClipboardContentType } from '@/types/api';
import { ClipboardItem, HistorySyncStatus } from '@/types/clipboard';
import { getDisplayKind } from '@/utils/displayKind';

/**
 * SQLite 行的形态(clipboard_history 表)。
 * 布尔字段用 0/1,可空字段用 null(而非 undefined,SQLite 绑定不认 undefined)。
 */
export interface HistoryRow {
  profileHash: string;
  type: string;
  text: string;
  displayKind: string | null;
  dataName: string | null;
  size: number | null;
  fileUri: string | null;
  hasData: number;
  hasRemoteData: number;
  localClipboardHash: string | null;
  timestamp: number;
  lastAccessed: number;
  lastModified: number;
  useCount: number;
  starred: number;
  pinned: number;
  isDeleted: number;
  isLocalFileReady: number;
  syncStatus: number;
  version: number;
  from: string | null;
  deviceName: string | null;
  synced: number | null;
  contentId: string | null;
}

/** 列顺序(单一事实源):INSERT / UPDATE / rowValues 都据此对齐 */
export const HISTORY_COLUMNS: (keyof HistoryRow)[] = [
  'profileHash',
  'type',
  'text',
  'displayKind',
  'dataName',
  'size',
  'fileUri',
  'hasData',
  'hasRemoteData',
  'localClipboardHash',
  'timestamp',
  'lastAccessed',
  'lastModified',
  'useCount',
  'starred',
  'pinned',
  'isDeleted',
  'isLocalFileReady',
  'syncStatus',
  'version',
  'from',
  'deviceName',
  'synced',
  'contentId',
];

const bool = (v: boolean | undefined | null): number => (v ? 1 : 0);
const optBool = (v: boolean | undefined | null): number | null =>
  v === undefined || v === null ? null : v ? 1 : 0;

/** ClipboardItem → 行对象(写入时物化 displayKind) */
export function toRow(item: ClipboardItem): HistoryRow {
  const text = item.text ?? '';
  return {
    profileHash: item.profileHash,
    type: item.type,
    text,
    displayKind: getDisplayKind(item.type, text),
    dataName: item.dataName ?? null,
    size: item.size ?? null,
    fileUri: item.fileUri ?? null,
    hasData: bool(item.hasData),
    hasRemoteData: bool(item.hasRemoteData),
    localClipboardHash: item.localClipboardHash ?? null,
    timestamp: item.timestamp ?? 0,
    lastAccessed: item.lastAccessed ?? 0,
    lastModified: item.lastModified ?? 0,
    useCount: item.useCount ?? 0,
    starred: bool(item.starred),
    pinned: bool(item.pinned),
    isDeleted: bool(item.isDeleted),
    isLocalFileReady: bool(item.isLocalFileReady),
    syncStatus: item.syncStatus ?? HistorySyncStatus.LocalOnly,
    version: item.version ?? 0,
    from: item.from ?? null,
    deviceName: item.deviceName ?? null,
    synced: optBool(item.synced),
    contentId: item.contentId ?? null,
  };
}

/** 行对象 → ClipboardItem(0/1 → 布尔;null → undefined) */
export function fromRow(row: HistoryRow): ClipboardItem {
  return {
    profileHash: row.profileHash,
    type: row.type as ClipboardContentType,
    text: row.text ?? '',
    dataName: row.dataName ?? undefined,
    size: row.size ?? undefined,
    fileUri: row.fileUri ?? undefined,
    hasData: !!row.hasData,
    hasRemoteData: !!row.hasRemoteData,
    localClipboardHash: row.localClipboardHash ?? undefined,
    timestamp: row.timestamp,
    lastAccessed: row.lastAccessed,
    lastModified: row.lastModified,
    useCount: row.useCount,
    starred: !!row.starred,
    pinned: !!row.pinned,
    isDeleted: !!row.isDeleted,
    isLocalFileReady: !!row.isLocalFileReady,
    syncStatus: row.syncStatus as HistorySyncStatus,
    version: row.version,
    from: row.from ?? undefined,
    deviceName: row.deviceName ?? undefined,
    synced: row.synced === null || row.synced === undefined ? undefined : !!row.synced,
    contentId: row.contentId ?? undefined,
  };
}

/** 按 HISTORY_COLUMNS 顺序取值,用于位置参数绑定(?, ?, ...) */
export function rowValues(row: HistoryRow): (string | number | null)[] {
  return HISTORY_COLUMNS.map((c) => row[c]);
}
