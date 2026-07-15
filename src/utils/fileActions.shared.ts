/**
 * File Action Utilities — 平台无关实现
 *
 * 这里只放两端完全一致的逻辑：MIME 推断、分享，以及保存到相册前的权限、暂存和清理。
 * 最终写入相册的 writer 由平台实现选择：Android 用 SDK 56 Asset API，iOS 用支持
 * add-only 权限的 legacy writer。
 */

import * as MediaLibrary from 'expo-media-library';
import i18n from '@/i18n';
import { log } from '@/services/Logger';

const GALLERY_IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'heic',
  'heif',
  'prm',
]);
let galleryExportsInitialization: Promise<void> | null = null;
type GalleryWriter = (fileUri: string) => Promise<unknown>;

function getGalleryImageExtension(value: string | undefined): string | null {
  if (!value) return null;
  const name = value.split(/[?#]/)[0].toLowerCase();
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  const extension = name.slice(dot + 1);
  return GALLERY_IMAGE_EXTENSIONS.has(extension) ? extension : null;
}

function removeGalleryExport(file: { exists: boolean; delete(): void; uri: string }): void {
  try {
    if (file.exists) file.delete();
  } catch (error) {
    log.warn(`[FileActions] Failed to remove gallery export ${file.uri}:`, error);
  }
}

export async function cleanupGalleryExports(): Promise<void> {
  try {
    const { Directory, File, Paths } = await import('expo-file-system');
    const exportDirectory = new Directory(Paths.cache, 'gallery-exports');
    if (!exportDirectory.exists) return;

    for (const entry of exportDirectory.list()) {
      if (entry instanceof File) removeGalleryExport(entry);
    }
  } catch (error) {
    log.warn('[FileActions] Failed to clean stale gallery exports:', error);
  }
}

export function initializeGalleryExports(): Promise<void> {
  galleryExportsInitialization ??= cleanupGalleryExports();
  return galleryExportsInitialization;
}

async function createGalleryCompatibleCopy(fileUri: string, extension: string) {
  const { Directory, File, Paths } = await import('expo-file-system');
  await initializeGalleryExports();
  const exportDirectory = new Directory(Paths.cache, 'gallery-exports');
  exportDirectory.create({ idempotent: true, intermediates: true });

  const normalizedExtension = extension === 'prm' ? 'png' : extension;
  const uniqueName = `gallery-${Date.now()}-${Math.random().toString(36).slice(2)}.${normalizedExtension}`;
  const stagedFile = new File(exportDirectory, uniqueName);

  try {
    await new File(fileUri).copy(stagedFile);
    return stagedFile;
  } catch (error) {
    removeGalleryExport(stagedFile);
    throw error;
  }
}

/**
 * 根据文件 URI / 文件名推断 MIME 类型
 */
export function getMimeTypeFromUri(fileUri: string): string {
  const name = fileUri.split('?')[0].toLowerCase();
  if (name.endsWith('.apk')) return 'application/vnd.android.package-archive';
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.mp4') || name.endsWith('.mkv') || name.endsWith('.avi')) return 'video/*';
  if (name.endsWith('.mp3') || name.endsWith('.flac') || name.endsWith('.aac')) return 'audio/*';
  if (
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    name.endsWith('.png') ||
    name.endsWith('.gif') ||
    name.endsWith('.webp') ||
    name.endsWith('.bmp') ||
    name.endsWith('.heic') ||
    name.endsWith('.heif') ||
    name.endsWith('.prm') // expo image format
  )
    return 'image/*';
  return '*/*';
}

/**
 * 通过系统分享对话框分享文件
 */
export async function shareFile(fileUri: string, fileName?: string): Promise<void> {
  const Sharing = await import('expo-sharing');
  const mimeType = getMimeTypeFromUri(fileUri);
  await Sharing.shareAsync(fileUri, {
    mimeType,
    dialogTitle: fileName || i18n.t('errors:share.dialogTitle'),
    UTI: mimeType,
  });
}

/**
 * 保存图片到相册
 * 仅支持图片类型文件
 */
export async function saveToGallery(
  fileUri: string,
  fileName?: string,
  writeToLibrary: GalleryWriter = (uri) => MediaLibrary.Asset.create(uri)
): Promise<void> {
  const sourceExtension = getGalleryImageExtension(fileUri);
  const fileNameExtension = getGalleryImageExtension(fileName);
  const isImage = sourceExtension !== null || fileNameExtension !== null;

  if (!isImage) {
    throw new Error(i18n.t('errors:file.imageOnly'));
  }

  const { status } = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
  if (status !== 'granted') {
    throw new Error('Media library permission denied');
  }

  let stagedFile: Awaited<ReturnType<typeof createGalleryCompatibleCopy>> | null = null;
  try {
    if (!sourceExtension || sourceExtension === 'prm') {
      stagedFile = await createGalleryCompatibleCopy(fileUri, fileNameExtension ?? 'png');
    }
    await writeToLibrary(stagedFile?.uri ?? fileUri);
  } finally {
    if (stagedFile) removeGalleryExport(stagedFile);
  }
}
