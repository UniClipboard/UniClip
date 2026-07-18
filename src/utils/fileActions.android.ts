/**
 * File Action Utilities — Android 实现
 *
 * 用 SAF（Storage Access Framework）+ 原生流式拷贝落地 `saveFile`，
 * 用 ACTION_VIEW Intent 落地 `openFile`。`shareFile` / `saveToGallery`
 * 两端一致，直接从 shared 复用。
 */

import { NativeModules, Platform } from 'react-native';
import { nativeCopyFile } from 'android-util';
import { log } from '@/services/Logger';
import type { FileActions } from './fileActions.types';
import { getMimeTypeFromUri, shareFile, saveToGallery } from './fileActions.shared';

export { shareFile, saveToGallery };

const APP_PACKAGE = 'app.uniclipboard.android';

/**
 * 通过系统 ACTION_VIEW Intent 打开文件
 * - APK 安装失败时自动跳转"安装未知来源"设置页
 * - Android 7+ 要求使用 content:// URI
 */
export async function openFile(fileUri: string): Promise<void> {
  const FileSystem = await import('expo-file-system/legacy');
  const IntentLauncher = await import('expo-intent-launcher');
  const mimeType = getMimeTypeFromUri(fileUri);

  const contentUri = await FileSystem.getContentUriAsync(fileUri);
  try {
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      type: mimeType,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    });
  } catch (error) {
    // APK 安装失败时引导开启"安装未知来源"权限
    if (mimeType === 'application/vnd.android.package-archive') {
      try {
        await IntentLauncher.startActivityAsync('android.settings.MANAGE_UNKNOWN_APP_SOURCES', {
          data: `package:${APP_PACKAGE}`,
        });
      } catch {}
    }
    throw error;
  }
}

/**
 * 将文件储存到用户选择的目录（Android SAF）
 * 会弹出系统文件夹选择器，将文件复制到所选位置。
 */
export async function saveFile(fileUri: string, fileName?: string): Promise<boolean> {
  const FileSystem = await import('expo-file-system/legacy');
  const { StorageAccessFramework } = FileSystem;

  const permissions = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permissions.granted) {
    // 用户在目录选择器里取消/拒绝授权——不是失败，静默返回。
    return false;
  }

  const name = fileName || fileUri.split('/').pop() || 'file';
  const mimeType = getMimeTypeFromUri(fileUri);

  const destUri = await StorageAccessFramework.createFileAsync(
    permissions.directoryUri,
    name,
    mimeType === '*/*' ? 'application/octet-stream' : mimeType
  );

  // 运行时检查，避免模块顶层静态求值时 NativeModules 尚未注入的问题
  const hashModule = Platform.OS === 'android' ? NativeModules.NativeUtilModule ?? null : null;
  log.info(
    '[saveFile] NativeModules.NativeUtilModule:',
    hashModule,
    'keys:',
    hashModule ? Object.keys(hashModule) : 'N/A'
  );

  if (hashModule?.copyFile) {
    // 原生流式拷贝：FileChannel.transferTo，不把文件读入 JS/Java 堆
    await nativeCopyFile(fileUri, destUri);
  } else {
    log.warn('[saveFile] falling back to base64, hashModule:', hashModule);
    // 降级：base64 读写（原生模块未加载时）
    const content = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await FileSystem.writeAsStringAsync(destUri, content, {
      encoding: FileSystem.EncodingType.Base64,
    });
  }

  return true;
}

// 编译期校验：本模块实现了完整的 FileActions 契约
const _impl: FileActions = { openFile, saveFile, shareFile, saveToGallery };
void _impl;
