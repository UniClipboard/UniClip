/**
 * uploadFile — 「落库」段(与「推送服务器」段解耦)
 *
 * 业务语义:上传 = 先落本地(瞬时、必成功) + 后台推送(可失败、可重试)。本文件只管落库:
 * - import*ToHistory():把内容复制/落库为 LocalOnly,立即返回 profileHash,**不碰网络**。
 *
 * 推送段已迁到 Rust 引擎直传:前台(HomeView FAB / ShareReceiveScreen)调 import* 落库后,
 * 把 profileHash 交给 BackgroundUploadManager → pushHistoryRecordViaEngine(uc-core putClipboard);
 * ProcessTextScreen 前台阻塞式路径同理(import* + pushHistoryRecordViaEngine)。服务端离线时
 * 内容已在本地(LocalOnly,卡片显示待上传角标),不会丢失、不阻塞界面。
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
import { SyncManager } from '@/services/SyncManager';
import { createDefaultClipboardItem, HistorySyncStatus } from '@/types/clipboard';
import type { ClipboardContentType } from '@/types/api';

function guessContentType(mimeType: string | null | undefined): ClipboardContentType {
  if (!mimeType) return 'File';
  if (mimeType.startsWith('image/')) return 'Image';
  return 'File';
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
