/**
 * Clipboard Proxy
 * 剪贴板代理 - 前台走系统接口，Android 后台委托给当前选中的访问适配器。
 */

import * as Clipboard from 'expo-clipboard';
import { Platform } from 'react-native';
import { nativeSaveClipboardImageToFile } from 'android-util';
import {
  nativeGetClipboardFileSourceId,
  nativeSaveClipboardFileToFile,
  type ClipboardFileInfo,
} from 'android-util';
import { log } from '@/services/Logger';
import { getBackgroundClipboardAdapter } from '@/utils/androidBackgroundClipboardAccess';

/**
 * 获取剪贴板文本
 */
export async function getStringAsync(options?: Clipboard.GetStringOptions): Promise<string> {
  const adapter = Platform.OS === 'android' ? getBackgroundClipboardAdapter('read') : null;
  if (adapter) {
    try {
      return await adapter.getString();
    } catch (e) {
      log.warn('[ClipboardProxy] Background getStringAsync failed, falling back:', e);
    }
  }
  return Clipboard.getStringAsync(options);
}

/**
 * 设置剪贴板文本
 *
 * Android 10+ 后台调用 setPrimaryClip 会被系统静默丢弃
 * （logcat: "Denying clipboard access ... not in focus"），
 * 因此后台时优先走悬浮窗夺焦点写入（原生侧带回读校验）。
 */
export async function setStringAsync(
  text: string,
  options?: Clipboard.SetStringOptions
): Promise<boolean> {
  const adapter = Platform.OS === 'android' ? getBackgroundClipboardAdapter('write') : null;
  if (adapter) {
    try {
      const ok = await adapter.setString(text);
      if (ok) return true;
      log.warn('[ClipboardProxy] Background setStringAsync verify failed, falling back');
    } catch (e) {
      log.warn('[ClipboardProxy] Background setStringAsync failed, falling back:', e);
    }
  }
  return Clipboard.setStringAsync(text, options);
}

/**
 * 检查剪贴板是否有文本
 */
export async function hasStringAsync(): Promise<boolean> {
  const adapter = Platform.OS === 'android' ? getBackgroundClipboardAdapter('read') : null;
  if (adapter) {
    try {
      return await adapter.hasString();
    } catch (e) {
      log.warn('[ClipboardProxy] Background hasStringAsync failed, falling back:', e);
    }
  }
  return Clipboard.hasStringAsync();
}

/**
 * 检查剪贴板是否有图片
 */
export async function hasImageAsync(): Promise<boolean> {
  const adapter = Platform.OS === 'android' ? getBackgroundClipboardAdapter('read') : null;
  if (adapter) {
    try {
      return await adapter.hasImage();
    } catch (e) {
      log.warn('[ClipboardProxy] Background hasImageAsync failed, falling back:', e);
    }
  }
  return Clipboard.hasImageAsync();
}

/**
 * 获取剪贴板图片（旧接口，返回 base64）
 */
export async function getImageAsync(
  options: Clipboard.GetImageOptions
): Promise<Clipboard.ClipboardImage | null> {
  return Clipboard.getImageAsync(options);
}

/**
 * 获取剪贴板图片并直接保存到文件（不经过 JS 内存）
 * @param destFileUri 目标文件 URI（file:// 格式）
 * @returns 成功返回 true，剪贴板无图片或失败返回 false
 */
export async function saveImageToFileAsync(
  destDirPath: string
): Promise<{ filePath: string; mimeType: string } | null> {
  const adapter = Platform.OS === 'android' ? getBackgroundClipboardAdapter('read') : null;
  if (adapter) {
    try {
      const result = await adapter.saveImageToFile(destDirPath);
      if (result) return result;
    } catch (e) {
      log.warn('[ClipboardProxy] Background saveImageToFileAsync failed, falling back:', e);
    }
  }
  // Android 前台：android-util 直接读取系统剪贴板并写入文件（不经过 JS 内存）
  if (Platform.OS === 'android') {
    const result = await nativeSaveClipboardImageToFile(destDirPath);
    return result ? { filePath: result.filePath, mimeType: result.mimeType } : null;
  }

  // iOS：通过 expo-clipboard 获取 base64 再写入文件
  if (Platform.OS === 'ios') {
    try {
      const image = await Clipboard.getImageAsync({ format: 'png' });
      if (!image || !image.data) return null;

      const { writeAsStringAsync, EncodingType } = await import('expo-file-system/legacy');
      const { Directory } = await import('expo-file-system');
      const dir = new Directory(destDirPath);
      if (!dir.exists) dir.create();

      const fileName = `clipboard_${Date.now()}.png`;
      const filePath = destDirPath.replace(/\/$/, '') + '/' + fileName;

      const prefix = image.data.indexOf('base64,');
      const base64 = prefix >= 0 ? image.data.slice(prefix + 7) : image.data;
      await writeAsStringAsync(filePath, base64, {
        encoding: EncodingType.Base64,
      });

      return { filePath, mimeType: 'image/png' };
    } catch (e) {
      log.warn('[ClipboardProxy] iOS getImageAsync failed:', e);
      return null;
    }
  }

  return null;
}

export async function saveFileToFileAsync(destDirPath: string): Promise<ClipboardFileInfo | null> {
  if (Platform.OS !== 'android') return null;
  return nativeSaveClipboardFileToFile(destDirPath);
}

export async function getFileSourceIdAsync(): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  return nativeGetClipboardFileSourceId();
}

/**
 * 设置剪贴板图片
 */
export async function setImageAsync(base64Image: string): Promise<void> {
  return Clipboard.setImageAsync(base64Image);
}
