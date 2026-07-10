/**
 * Clipboard Proxy
 * 剪贴板代理 - 在 Android 后台时通过悬浮窗获取剪贴板，其他情况直接调用 expo-clipboard
 *
 * 优先级：悬浮窗（仅事件触发的按需读）> 直接调用
 *
 * 当启用后台同步+悬浮窗模式时，悬浮窗按需显示（不可见的 1px 窗口），
 * 每次读取剪贴板时只是 focus 到悬浮窗读取后 unfocus，而非反复创建/销毁。
 * 若持续 10 秒无后台剪贴板调用，自动关闭悬浮窗以节省资源，下次需要时再打开。
 */

import * as Clipboard from 'expo-clipboard';
import { AppState, Platform } from 'react-native';
import { useSettingsStore } from '@/stores/settingsStore';
import { setTimer, clearTimer } from 'native-timer';
import { nativeSaveClipboardImageToFile } from 'android-util';
import { log } from '@/services/Logger';

/** 悬浮窗空闲超时时间（毫秒） */
const OVERLAY_IDLE_TIMEOUT_MS = 10_000;
/** 空闲计时器的固定 tag */
const IDLE_TIMER_TAG = 'clipboard_overlay_idle';

let overlayModule: typeof import('clipboard-overlay') | null = null;

/**
 * 是否允许「按需」走悬浮窗读取剪贴板。
 *
 * 默认 false：常规轮询读取绝不抢焦点（每秒抢一次会顶掉前台键盘，不可接受）。
 * 仅当事件驱动监听器（logcat 触发，确有一次复制发生）读取时，由 ClipboardMonitor
 * 临时置 true——此时抢焦点与「写入」同为低频事件驱动，可接受。
 */
let onDemandReadAllowed = false;

/** 由 ClipboardMonitor 在事件触发的读取前后调用，短暂放开/收回悬浮窗读取。 */
export function setOnDemandRead(allowed: boolean): void {
  onDemandReadAllowed = allowed;
}

/**
 * 重置空闲计时器：每次悬浮窗被使用时调用，
 * 10 秒内无新调用则自动关闭悬浮窗。
 * 使用 native-timer 以确保后台可靠运行。
 */
function resetIdleTimer(): void {
  // 先清除已有的计时器，再重新启动
  clearTimer(IDLE_TIMER_TAG);
  setTimer(
    () => {
      // 触发一次后立即清除自身（模拟 setTimeout）
      clearTimer(IDLE_TIMER_TAG);
      if (overlayModule?.isOverlayShowing()) {
        overlayModule.hideOverlayWindow().catch((e) => {
          log.warn('[ClipboardProxy] Failed to hide overlay on idle timeout:', e);
        });
      }
    },
    OVERLAY_IDLE_TIMEOUT_MS,
    IDLE_TIMER_TAG
  );
}

/** 清除空闲计时器（应用回前台或手动关闭时） */
function clearIdleTimer(): void {
  clearTimer(IDLE_TIMER_TAG);
}

if (Platform.OS === 'android') {
  overlayModule = require('clipboard-overlay');

  // 当应用回到前台时，自动销毁常驻悬浮窗并清除空闲计时器
  AppState.addEventListener('change', (nextAppState) => {
    if (nextAppState === 'active') {
      clearIdleTimer();
      if (overlayModule?.isOverlayShowing()) {
        overlayModule.hideOverlayWindow().catch((e) => {
          log.warn('[ClipboardProxy] Failed to dismiss overlay on foreground:', e);
        });
      }
    }
  });
}

/**
 * 确保悬浮窗已显示（仅在需要时创建）
 */
async function ensureOverlayShowing(): Promise<void> {
  if (!overlayModule) return;
  if (!overlayModule.isOverlayShowing()) {
    try {
      await overlayModule.showOverlayWindow();
    } catch (e) {
      log.warn('[ClipboardProxy] Failed to show persistent overlay:', e);
    }
  }
}

/**
 * 隐藏悬浮窗
 */
export async function dismissOverlay(): Promise<void> {
  if (!overlayModule) return;
  if (overlayModule.isOverlayShowing()) {
    try {
      await overlayModule.hideOverlayWindow();
    } catch (e) {
      log.warn('[ClipboardProxy] Failed to hide persistent overlay:', e);
    }
  }
}

/**
 * 判断是否应该使用悬浮窗访问剪贴板
 * 条件：Android + 后台 + 设置启用 + 权限已授予
 * 如果条件满足，确保悬浮窗已常驻显示
 *
 * 写入：夺取窗口焦点会顶掉前台应用的键盘/输入焦点，但写入是事件驱动
 * （收到远端新内容），偶发短暂夺焦可以接受。
 * 读取：常规轮询读取绝不抢焦点（onDemandReadAllowed=false）；仅当事件驱动监听器
 * （确有一次复制发生）读取时短暂放开，与写入同为低频事件驱动，可接受。
 */
async function shouldUseOverlay(purpose: 'read' | 'write'): Promise<boolean> {
  if (Platform.OS !== 'android' || !overlayModule) return false;
  if (AppState.currentState !== 'background') return false;
  if (purpose === 'read' && !onDemandReadAllowed) return false;
  const config = useSettingsStore.getState().config;
  if (!(config?.enableClipboardOverlay ?? false)) return false;
  // Sync overlay visibility and retry count to native module
  const isDebug = config?.debugMode ?? false;
  const showOverlay = isDebug && (config?.debugOverlayVisible ?? false);
  overlayModule.setDebugMode(showOverlay);
  overlayModule.setMaxRetries(isDebug ? 20 : 5);
  if (!overlayModule.hasOverlayPermission()) return false;
  // Ensure persistent overlay is showing before reading clipboard
  await ensureOverlayShowing();
  // Reset idle timer: 10 seconds without calls will auto-hide overlay
  resetIdleTimer();
  return true;
}

/**
 * 获取剪贴板文本
 */
export async function getStringAsync(options?: Clipboard.GetStringOptions): Promise<string> {
  if (await shouldUseOverlay('read')) {
    try {
      return await overlayModule!.getStringViaOverlay();
    } catch (e) {
      log.warn('[ClipboardProxy] Overlay getStringAsync failed, falling back:', e);
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
  if (await shouldUseOverlay('write')) {
    try {
      const ok = await overlayModule!.setStringViaOverlay(text);
      if (ok) return true;
      log.warn('[ClipboardProxy] Overlay setStringAsync verify failed, falling back');
    } catch (e) {
      log.warn('[ClipboardProxy] Overlay setStringAsync failed, falling back:', e);
    }
  }
  return Clipboard.setStringAsync(text, options);
}

/**
 * 检查剪贴板是否有文本
 */
export async function hasStringAsync(): Promise<boolean> {
  if (await shouldUseOverlay('read')) {
    try {
      return await overlayModule!.hasStringViaOverlay();
    } catch (e) {
      log.warn('[ClipboardProxy] Overlay hasStringAsync failed, falling back:', e);
    }
  }
  return Clipboard.hasStringAsync();
}

/**
 * 检查剪贴板是否有图片
 */
export async function hasImageAsync(): Promise<boolean> {
  if (await shouldUseOverlay('read')) {
    try {
      return await overlayModule!.hasImageViaOverlay();
    } catch (e) {
      log.warn('[ClipboardProxy] Overlay hasImageAsync failed, falling back:', e);
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
  if (await shouldUseOverlay('read')) {
    try {
      const result = await overlayModule!.getImageViaOverlay();
      if (result) {
        return {
          data: result.data,
          size: result.size,
        };
      }
      return null;
    } catch (e) {
      log.warn('[ClipboardProxy] Overlay getImageAsync failed, falling back:', e);
    }
  }
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
  if (await shouldUseOverlay('read')) {
    try {
      const result = await overlayModule!.saveImageToFileViaOverlay(destDirPath);
      if (result) return { filePath: result.filePath, mimeType: result.mimeType };
      // fallback if overlay failed
    } catch (e) {
      log.warn('[ClipboardProxy] Overlay saveImageToFileAsync failed, falling back:', e);
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

/**
 * 设置剪贴板图片
 */
export async function setImageAsync(base64Image: string): Promise<void> {
  return Clipboard.setImageAsync(base64Image);
}
