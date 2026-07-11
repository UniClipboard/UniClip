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

import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import { nativeCopyFile, type ProgressInfo } from 'android-util';
import i18n from '@/i18n';
import { calculateFileProfileHash, calculateTextHash } from '@/utils/hash';
import { prepareTempFilePath } from '@/utils/fileStorage';
import { sanitizeDataName } from '@/utils/fileName';
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

  // 清洗文件名：签名 URL 临时名里的 `?t=…` 会让服务端 staging 建文件失败（500）。
  // 用清洗后的名做本地临时路径 + dataName，两端一致；hash 只取字节不受影响。
  fileName = sanitizeDataName(fileName);

  const contentType: ClipboardContentType = guessContentType(mimeType);
  const tempPath = prepareTempFilePath(fileName);
  const sourceFile = new File(sourceUri);
  options?.onProgress?.(i18n.t('share:upload.copying'));
  // nativeCopyFile 仅 Android 可用(FileChannel 流式拷贝,不占 JS 堆);
  // iOS 该原生模块不存在,改走 expo-file-system 的 File.copy,否则整条落库路径抛错「保存失败」。
  if (Platform.OS === 'android') {
    await nativeCopyFile(sourceFile.uri, tempPath);
  } else {
    await sourceFile.copy(new File(tempPath), { overwrite: true });
  }

  options?.onProgress?.(i18n.t('share:upload.hashing'));
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
 *
 * @deprecated 遗留 SyncClipboardClient 直传路径,走 `POST /api/history`(daemon 0.19 已弃)。
 *   显式上传改走 `pushHistoryRecordViaEngine`(uc-core `putClipboard` 直传)。仅
 *   `uploadTextAndAddToHistory` 内部仍引用,待 Phase 2 一并移除,勿新增调用方。
 */
export async function pushHistoryRecord(
  profileHash: string,
  activeServer: ServerConfig,
  options?: UploadFileOptions
): Promise<void> {
  const item = await historyStorage.getItem(profileHash);
  if (!item) throw new Error(i18n.t('share:upload.recordNotFound', { hash: profileHash }));
  if (item.syncStatus === HistorySyncStatus.Synced) return;

  const content = historyItemToContent(item);
  const apiClient = createAPIClient(activeServer);
  options?.onProgress?.(i18n.t('share:upload.uploading'));
  await apiClient.putContent(content, {
    signal: options?.signal,
    onProgress: (info) => options?.onProgress?.(i18n.t('share:upload.uploading'), info),
  });

  await useHistoryStore
    .getState()
    .updateItem(profileHash, { syncStatus: HistorySyncStatus.Synced });
}

/**
 * 落库 + 同步推送文本(前台阻塞式,供 ProcessTextScreen 就地展示结果)。
 * 本地记录先保存,上传失败向上抛出但内容不丢失,后续由同步引擎/重试补推。
 *
 * @deprecated 走遗留 {@link pushHistoryRecord}。生产已改用 `importTextToHistory` +
 *   `pushHistoryRecordViaEngine`;当前仅 `uploadText.dataloss.test.ts` 回归用例引用,
 *   待 Phase 2 连同遗留直传一并移除。
 */
export async function uploadTextAndAddToHistory(
  text: string,
  activeServer: ServerConfig,
  options?: { signal?: AbortSignal }
): Promise<void> {
  const { profileHash } = await importTextToHistory(text, options);
  await pushHistoryRecord(profileHash, activeServer, { signal: options?.signal });
}
