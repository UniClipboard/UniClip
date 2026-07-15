/**
 * File Action Utilities — 平台无关实现
 *
 * 这里只放两端完全一致的逻辑：MIME 推断、分享，以及保存到相册前的类型和权限校验。
 * 最终写入相册的 writer 由平台实现选择：Android 用 SDK 56 Asset API，iOS 由 PhotoKit
 * 直接读取源 payload，避免为无扩展名的 App Group 文件创建明文暂存副本。
 */

import * as MediaLibrary from 'expo-media-library';
import i18n from '@/i18n';

const GALLERY_IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'heic',
  'heif',
]);
type GalleryWriter = (fileUri: string, fileName?: string) => Promise<unknown>;

function getGalleryImageExtension(value: string | undefined): string | null {
  if (!value) return null;
  const name = value.split(/[?#]/)[0].toLowerCase();
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  const extension = name.slice(dot + 1);
  return GALLERY_IMAGE_EXTENSIONS.has(extension) ? extension : null;
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
  if (getGalleryImageExtension(name)) return 'image/*';
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

  await writeToLibrary(fileUri, fileName);
}
