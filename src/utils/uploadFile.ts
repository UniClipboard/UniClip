/**
 * uploadFile — 「保存本地」与「推送服务器」两段式
 *
 * 业务语义:上传 = 先落本地(瞬时、必成功) + 后台推送(可失败、可重试)。
 * - import*ToHistory():只把内容复制/落库为 LocalOnly,立即返回,不碰网络。
 * - pushHistoryRecord():从本地库读出该记录并推送到服务器,成功后标记 Synced。
 * - upload*AndAddToHistory():import + push 的组合(保持旧签名,供 ProcessTextScreen 等
 *   仍需「落库即上传、就地展示结果」的前台路径使用)。
 *
 * 前台(HomeView FAB / ShareReceiveScreen)只调 import*,推送交给 BackgroundUploadManager;
 * 服务端离线时内容已在本地(LocalOnly,卡片显示待上传角标),不会丢失、不阻塞界面。
 */

import { File } from 'expo-file-system';
import { nativeCopyFile, type ProgressInfo } from 'native-util';
import { calculateFileProfileHash, calculateTextHash } from '@/utils/hash';
import { prepareTempFilePath } from '@/utils/fileStorage';
import { convertHeicToJpegIfNeeded } from '@/utils/heicToJpeg';
import { useHistoryStore } from '@/stores/historyStore';
import { createAPIClient, historyStorage } from '@/services';
import { SyncManager } from '@/services/SyncManager';
import type { ClipboardContent, ClipboardItem } from '@/types/clipboard';
import { createDefaultClipboardItem, HistorySyncStatus } from '@/types/clipboard';
import type { ClipboardContentType } from '@/types/api';
import type { ServerConfig } from '@/types/api';

function guessContentType(mimeType: string | null | undefined): ClipboardContentType {
  if (!mimeType) return 'File';
  if (mimeType.startsWith('image/')) return 'Image';
  return 'File';
}

/** 本地历史记录 → 上传用 ClipboardContent(供后台推送重建内容,不依赖内存态) */
function historyItemToContent(item: ClipboardItem): ClipboardContent {
  return {
    type: item.type,
    text: item.text,
    fileUri: item.fileUri,
    fileName: item.dataName ?? item.text,
    fileSize: item.size,
    profileHash: item.profileHash,
    localClipboardHash: item.localClipboardHash ?? item.profileHash,
    hasData: item.hasData,
    timestamp: item.timestamp,
  };
}

export interface UploadFileOptions {
  signal?: AbortSignal;
  onProgress?: (stage: string, progress?: ProgressInfo) => void;
}

export interface ImportResult {
  profileHash: string;
  fileUri: string;
  fileName: string;
  fileSize: number;
  contentType: ClipboardContentType;
}

/**
 * 仅落库(文件/图片):复制到 temp、算 hash、写入历史(LocalOnly)。
 * 不碰网络;返回可用于后台推送的 profileHash。
 */
export async function importFileToHistory(
  sourceUri: string,
  fileName: string,
  mimeType: string | null | undefined,
  fileSize: number | undefined,
  options?: UploadFileOptions
): Promise<ImportResult> {
  // iOS 相册/分享内容多为 HEIC，发送前转为 JPEG（其它格式与平台原样透传）
  ({
    uri: sourceUri,
    fileName,
    mimeType,
    fileSize,
  } = await convertHeicToJpegIfNeeded(sourceUri, fileName, mimeType, fileSize));

  const contentType: ClipboardContentType = guessContentType(mimeType);
  const tempPath = prepareTempFilePath(fileName);
  const sourceFile = new File(sourceUri);
  options?.onProgress?.('正在复制文件…');
  await nativeCopyFile(sourceFile.uri, tempPath);

  options?.onProgress?.('正在计算哈希…');
  const profileHash = await calculateFileProfileHash(tempPath, fileName);
  const resolvedSize = fileSize ?? sourceFile.size;

  const savedItem = await useHistoryStore.getState().addItem(
    createDefaultClipboardItem({
      type: contentType,
      text: fileName,
      profileHash,
      hasData: true,
      dataName: fileName,
      size: resolvedSize,
      timestamp: Date.now(),
      fileUri: tempPath,
    })
  );

  // 预先设置 hash，避免轮询/SSE 拉取时把自己刚落库的内容误判为新远程内容触发下载
  SyncManager.getInstance().setLastUploadedHash(profileHash);

  return {
    profileHash,
    fileUri: savedItem.fileUri ?? tempPath,
    fileName,
    fileSize: resolvedSize,
    contentType,
  };
}

/**
 * 仅落库(文本):算 hash、写入历史(LocalOnly)。不碰网络;返回 profileHash。
 */
export async function importTextToHistory(
  text: string,
  options?: { signal?: AbortSignal }
): Promise<{ profileHash: string }> {
  const profileHash = await calculateTextHash(text, options?.signal);

  await useHistoryStore.getState().addItem(
    createDefaultClipboardItem({
      type: 'Text',
      text,
      profileHash,
      hasData: false,
      timestamp: Date.now(),
      localClipboardHash: profileHash,
      syncStatus: HistorySyncStatus.LocalOnly,
    })
  );

  // 预先设置 hash，避免轮询/SSE 拉取时误判为新远程内容触发自动下载
  SyncManager.getInstance().setLastUploadedHash(profileHash);

  return { profileHash };
}

/**
 * 推送一条已落库的记录到服务器,成功后标记 Synced。
 * 从本地库读记录重建内容,因此可用于后台重试与「稍后重推」——不依赖调用方内存态。
 * 若记录已是 Synced 则直接返回(幂等)。
 */
export async function pushHistoryRecord(
  profileHash: string,
  activeServer: ServerConfig,
  options?: UploadFileOptions
): Promise<void> {
  const item = await historyStorage.getItem(profileHash);
  if (!item) throw new Error(`记录不存在: ${profileHash}`);
  if (item.syncStatus === HistorySyncStatus.Synced) return;

  const content = historyItemToContent(item);
  const apiClient = createAPIClient(activeServer);
  options?.onProgress?.('正在上传…');
  await apiClient.putContent(content, {
    signal: options?.signal,
    onProgress: (info) => options?.onProgress?.('正在上传…', info),
  });

  await useHistoryStore
    .getState()
    .updateItem(profileHash, { syncStatus: HistorySyncStatus.Synced });
}

/**
 * 落库 + 同步推送文本(前台阻塞式,供 ProcessTextScreen 就地展示结果)。
 * 本地记录先保存,上传失败向上抛出但内容不丢失,后续由同步引擎/重试补推。
 */
export async function uploadTextAndAddToHistory(
  text: string,
  activeServer: ServerConfig,
  options?: { signal?: AbortSignal }
): Promise<void> {
  const { profileHash } = await importTextToHistory(text, options);
  await pushHistoryRecord(profileHash, activeServer, { signal: options?.signal });
}

/**
 * 落库 + 同步推送文件(前台阻塞式)。本地先落库,上传失败内容不丢失。
 */
export async function uploadFileAndAddToHistory(
  sourceUri: string,
  fileName: string,
  mimeType: string | null | undefined,
  fileSize: number | undefined,
  activeServer: ServerConfig,
  options?: UploadFileOptions
): Promise<void> {
  const result = await importFileToHistory(sourceUri, fileName, mimeType, fileSize, options);
  await pushHistoryRecord(result.profileHash, activeServer, options);
}
