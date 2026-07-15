/**
 * File Action Utilities — iOS 实现
 *
 * - `saveFile`：走 `document-exporter` 原生模块（UIDocumentPicker export 模式），
 *   让用户自己选保存位置，语义上与「分享」区分开。
 * - `openFile`：iOS 没有 ACTION_VIEW，交给系统分享/预览面板处理。
 * - `shareFile`：两端一致，从 shared 复用。
 * - `saveToGallery`：复用 shared 的校验/权限逻辑，由 PhotoKit 直接读取 App Group payload。
 */

import { exportFile, saveImageToPhotoLibrary } from 'document-exporter';
import type { FileActions } from './fileActions.types';
import { shareFile, saveToGallery as saveToGalleryShared } from './fileActions.shared';

export { shareFile };

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
