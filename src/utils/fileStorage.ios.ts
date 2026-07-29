/**
 * iOS clipboard storage is shared with the native app and its extensions.
 * Payload identifiers and paths must stay aligned with PayloadCache.swift.
 */
import { Directory, File, Paths } from 'expo-file-system';
import {
  clearPayloads,
  deletePayload,
  getContainerUrl,
  getPayloadFileUri,
  getPayloadStats,
  writePayload,
} from 'app-group-store';
import { log } from '@/services/Logger';

export { calculateDirectorySize, clearDirectory, getFileExtension } from './fileStorage.shared';

// Kept for legacy callers. History payloads themselves live in the App Group.
export const HISTORY_BASE_DIR = new Directory(Paths.document, 'clipboards', 'history');
export const CLIPBOARD_TEMP_DIR = new Directory(Paths.cache, 'temp_files');

export async function initFileStorage(): Promise<void> {
  try {
    await getContainerUrl();
    if (!CLIPBOARD_TEMP_DIR.exists) CLIPBOARD_TEMP_DIR.create();
  } catch (error) {
    log.error('[FileStorage] Failed to initialize iOS storage:', error);
    throw error;
  }
}

export function getHistoryFileDir(type: string, profileHash: string): Directory {
  return new Directory(HISTORY_BASE_DIR, makePayloadProfileId(type, profileHash));
}

export async function saveHistoryFile(
  type: string,
  profileHash: string,
  _fileName: string,
  data: ArrayBuffer
): Promise<string> {
  return writeAppGroupPayload(makePayloadProfileId(type, profileHash), data);
}

export async function getHistoryFileUri(
  type: string,
  profileHash: string,
  _fileName: string
): Promise<string | null> {
  return getPayloadFileUri(makePayloadProfileId(type, profileHash));
}

export function prepareTempFilePath(fileName: string): string {
  if (!CLIPBOARD_TEMP_DIR.exists) CLIPBOARD_TEMP_DIR.create();
  return new File(CLIPBOARD_TEMP_DIR, fileName).uri;
}

export async function prepareHistoryFileUri(
  type: string,
  profileHash: string,
  _fileName: string
): Promise<string> {
  return getAppGroupPayloadTargetUri(makePayloadProfileId(type, profileHash));
}

export async function deleteHistoryFileDir(type: string, profileHash: string): Promise<void> {
  await deletePayload(makePayloadProfileId(type, profileHash));
}

export async function clearHistoryFiles(): Promise<void> {
  await clearPayloads();
}

export async function getHistoryStorageSize(): Promise<number> {
  return (await getPayloadStats()).totalSize;
}

export async function cleanupOrphanedHistoryFiles(
  _validProfileHashes: Set<string>
): Promise<number> {
  // The native cache intentionally owns enumeration and eviction. Its JS interface
  // exposes safe content-addressed operations only, so orphan cleanup is a no-op.
  return 0;
}

export async function saveFile(
  type: 'Image' | 'File',
  fileHash: string,
  data: ArrayBuffer,
  _extension?: string
): Promise<string> {
  const profileId = makePayloadProfileId(type, fileHash);
  const existing = await getPayloadFileUri(profileId);
  return existing ?? writeAppGroupPayload(profileId, data);
}

export async function getFileUri(
  type: 'Image' | 'File',
  fileHash: string,
  _extension?: string
): Promise<string | null> {
  return getPayloadFileUri(makePayloadProfileId(type, fileHash));
}

export async function deleteFile(
  type: 'Image' | 'File',
  fileHash: string,
  _extension?: string
): Promise<void> {
  await deletePayload(makePayloadProfileId(type, fileHash));
}

export async function clearAllFiles(): Promise<void> {
  await clearPayloads();
}

export async function getStorageStats(): Promise<{
  imageCount: number;
  fileCount: number;
  totalSize: number;
}> {
  try {
    const stats = await getPayloadStats();
    return { imageCount: stats.count, fileCount: 0, totalSize: stats.totalSize };
  } catch (error) {
    log.error('[FileStorage] Failed to get iOS storage stats:', error);
    return { imageCount: 0, fileCount: 0, totalSize: 0 };
  }
}

export async function downloadAndSaveFile(
  type: 'Image' | 'File',
  fileHash: string,
  downloadUrl: string,
  headers?: Record<string, string>,
  _extension?: string
): Promise<string> {
  const profileId = makePayloadProfileId(type, fileHash);
  const existing = await getPayloadFileUri(profileId);
  if (existing) return existing;

  const targetUri = await getAppGroupPayloadTargetUri(profileId);
  await File.downloadFileAsync(downloadUrl, new File(targetUri), { headers: headers || {} });
  return targetUri;
}

function makePayloadProfileId(type: string, profileHash: string): string {
  return `${type}-${profileHash}`;
}

async function writeAppGroupPayload(profileId: string, data: ArrayBuffer): Promise<string> {
  const uri = await writePayload(profileId, new Uint8Array(data));
  if (!uri) throw new Error(`Failed to write App Group payload: ${profileId}`);
  return uri;
}

async function getAppGroupPayloadTargetUri(profileId: string): Promise<string> {
  const containerUrl = await getContainerUrl();
  if (!containerUrl) throw new Error('App Group container is unavailable');
  await getPayloadFileUri(profileId);
  return `${containerUrl.replace(/\/+$/, '')}/payloads/${profileId}`;
}
