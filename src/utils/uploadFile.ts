/**
 * uploadFile — 「落库」段(与「推送服务器」段解耦)
 *
 * 业务语义:上传 = 先落本地(瞬时、必成功) + 后台推送(可失败、可重试)。本文件只管落库:
 * - import*ToHistory():把内容复制/落库为 LocalOnly,立即返回 profileHash,**不碰网络**。
 *
 * 前台发送入口先调用 import* 落库，再通过 UnifiedContentService 发送到当前空间。
 * 网络不可用时内容仍保留在本地历史中，不会因发送失败而丢失。
 */

import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import { nativeCopyFile, type ProgressInfo } from 'android-util';
import i18n from '@/i18n';
import { calculateFileProfileHash, calculateTextHash } from '@/utils/hash';
import { prepareTempFilePath } from '@/platform/files';
import { sanitizeDataName } from '@/utils/fileName';
import { convertHeicToJpegIfNeeded } from '@/utils/heicToJpeg';
import { useHistoryStore } from '@/features/history';
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
  skipInitialCopyOnIOS?: boolean;
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
 *
 * **调用方契约**:必须先 `await` 本函数完成落库，再触发空间发送。
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
  const sourceFile = new File(sourceUri);
  let workingUri = sourceFile.uri;
  if (!(Platform.OS === 'ios' && options?.skipInitialCopyOnIOS)) {
    const tempPath = prepareTempFilePath(fileName);
    options?.onProgress?.(i18n.t('share:upload.copying'));
    // nativeCopyFile 仅 Android 可用(FileChannel 流式拷贝,不占 JS 堆);
    // iOS 该原生模块不存在,改走 expo-file-system 的 File.copy,否则整条落库路径抛错「保存失败」。
    if (Platform.OS === 'android') {
      await nativeCopyFile(sourceFile.uri, tempPath);
    } else {
      await sourceFile.copy(new File(tempPath), { overwrite: true });
    }
    workingUri = tempPath;
  }

  options?.onProgress?.(i18n.t('share:upload.hashing'));
  const profileHash = await calculateFileProfileHash(workingUri, fileName);
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
      fileUri: workingUri,
    })
  );
  if (Platform.OS === 'ios' && options?.skipInitialCopyOnIOS && savedItem.fileUri === workingUri) {
    throw new Error('Failed to persist the staged file in history storage');
  }

  return {
    profileHash,
    fileUri: savedItem.fileUri ?? workingUri,
    fileName,
    fileSize: resolvedSize,
    contentType,
  };
}

/**
 * 仅落库(文本):算 hash、写入历史(LocalOnly)。不碰网络;返回 profileHash。
 *
 * **调用方契约**:必须先 `await` 本函数完成落库，再触发空间发送。
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

  return { profileHash };
}
