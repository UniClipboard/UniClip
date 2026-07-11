/**
 * File Action Utilities — 平台无关实现
 *
 * 这里只放两端完全一致、仅依赖跨平台 expo API 的逻辑：MIME 推断，以及
 * `shareFile` / `saveToGallery`。平台特有的 `openFile` / `saveFile` 分别在
 * `fileActions.ios.ts` / `fileActions.android.ts` 中实现，并复用此处的导出。
 */

import * as MediaLibrary from 'expo-media-library';
import i18n from '@/i18n';

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
export async function saveToGallery(fileUri: string): Promise<void> {
  const mimeType = getMimeTypeFromUri(fileUri);
  const isImage = mimeType.startsWith('image/');

  if (!isImage) {
    throw new Error(i18n.t('errors:file.imageOnly'));
  }

  const { status } = await MediaLibrary.requestPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Media library permission denied');
  }

  await MediaLibrary.createAssetAsync(fileUri);
}
