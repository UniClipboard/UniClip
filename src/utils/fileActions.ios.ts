/**
 * File Action Utilities — iOS 实现
 *
 * - `saveFile`：走 `document-exporter` 原生模块（UIDocumentPicker export 模式），
 *   让用户自己选保存位置，语义上与「分享」区分开。
 * - `openFile`：iOS 没有 ACTION_VIEW，交给系统分享/预览面板处理。
 * - `shareFile`：历史记录里的 App Group payload 本身是按内容 hash 命名、没有扩展名的
 *   （见 fileStorage.ios.ts），直接把这种 URI 交给 `Sharing.shareAsync` 时，系统分享面板
 *   显示的文件名/后缀就是磁盘上那个无后缀的名字——`shareAsync` 并不支持单独覆盖显示名。
 *   这里在分享前把 payload 拷贝成一个用原始文件名命名的临时文件，再分享那个临时文件。
 * - `saveToGallery`：复用 shared 的校验/权限逻辑，由 PhotoKit 直接读取 App Group payload。
 */

import { Directory, File } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { exportFile, saveImageToPhotoLibrary } from 'document-exporter';
import { CLIPBOARD_TEMP_DIR } from '@/platform/files';
import { sanitizeDataName } from './fileName';
import type { FileActions } from './fileActions.types';
import { shareFile as shareFileShared, saveToGallery as saveToGalleryShared } from './fileActions.shared';

/**
 * 通过系统分享对话框分享文件。
 *
 * App Group payload 的磁盘文件名是内容 hash，不带扩展名；分享前拷贝成一份以
 * `fileName` 命名的临时文件，这样系统分享面板和接收方看到的才是正确的文件名/后缀。
 * 每次分享都拷到独立的随机子目录下，避免两次分享重名文件（如连续分享两张 image.jpg）
 * 时后一次的 overwrite 覆盖前一次还在被分享目标异步读取的那份。临时文件留在
 * `CLIPBOARD_TEMP_DIR`，跟其他分享用临时文件一样由「清除缓存」统一回收，不在分享结束
 * 后立即删除——分享目标（存到文件 / AirDrop 等）可能在面板关闭后才异步读取。
 */
export async function shareFile(fileUri: string, fileName?: string): Promise<void> {
  if (!fileName) {
    await shareFileShared(fileUri);
    return;
  }

  const safeName = sanitizeDataName(fileName);
  if (fileUri.split('/').pop() === safeName) {
    await shareFileShared(fileUri, fileName);
    return;
  }

  if (!CLIPBOARD_TEMP_DIR.exists) CLIPBOARD_TEMP_DIR.create();
  const shareDir = new Directory(CLIPBOARD_TEMP_DIR, Crypto.randomUUID());
  shareDir.create();
  const namedFile = new File(shareDir, safeName);
  await new File(fileUri).copy(namedFile, { overwrite: true });
  await shareFileShared(namedFile.uri, fileName);
}

export async function saveToGallery(fileUri: string, fileName?: string): Promise<void> {
  await saveToGalleryShared(fileUri, fileName, saveImageToPhotoLibrary);
}

/**
 * iOS 打开文件：交给系统分享/预览面板处理。
 */
export async function openFile(fileUri: string): Promise<void> {
  await shareFile(fileUri);
}

/**
 * iOS 保存文件：弹出系统文件导出选择器，用户自选保存位置。
 * @returns `true` 已保存；`false` 用户取消。
 */
export async function saveFile(fileUri: string, fileName?: string): Promise<boolean> {
  const savedUri = await exportFile(fileUri, fileName);
  return savedUri != null;
}

// 编译期校验：本模块实现了完整的 FileActions 契约
const _impl: FileActions = { openFile, saveFile, shareFile, saveToGallery };
void _impl;
