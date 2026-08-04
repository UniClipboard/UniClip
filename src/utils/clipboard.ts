/**
 * Clipboard helpers
 */

import { ClipboardContent, ClipboardContentType } from '@/types';
import { isTextInvalid } from './textUtils';
import { createLogger } from '@/support/observability';
import i18n from '@/i18n';

const log = createLogger('Clipboard');

/** 从 MIME 类型获取文件扩展名。 */
export function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'text/plain': 'txt',
    'text/html': 'html',
    'application/pdf': 'pdf',
    'application/zip': 'zip',
    'application/json': 'json',
    'application/xml': 'xml',
  };

  return mimeToExt[mimeType.toLowerCase()] || 'bin';
}

/**
 * 从文件名获取扩展名
 */
export function getExtensionFromFileName(fileName: string): string {
  const match = fileName.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : 'bin';
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * 获取剪贴板类型的显示名称
 */
export function getClipboardTypeDisplayName(type: ClipboardContentType): string {
  const displayNames: Record<ClipboardContentType, string> = {
    Text: i18n.t('errors:contentType.text'),
    Image: i18n.t('errors:contentType.image'),
    File: i18n.t('errors:contentType.file'),
    Group: i18n.t('errors:contentType.group'),
  };

  return displayNames[type] || i18n.t('errors:contentType.unknown');
}

/**
 * 获取剪贴板类型的图标名称（可用于 UI 图标）
 */
export function getClipboardTypeIcon(type: ClipboardContentType): string {
  const icons: Record<ClipboardContentType, string> = {
    Text: 'text',
    Image: 'image',
    File: 'file',
    Group: 'folder',
  };

  return icons[type] || 'help';
}

/**
 * 截断文本预览
 */
export function truncateText(text: string, maxLength: number = 100): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + '...';
}

/**
 * 验证剪贴板内容
 */
export function validateClipboardContent(content: ClipboardContent): boolean {
  if (!content || !content.type) {
    return false;
  }

  switch (content.type) {
    case 'Text':
      return typeof content.text === 'string' && content.text.length > 0;

    case 'Image':
      return Boolean(content.fileUri || content.fileName);

    case 'File':
    case 'Group':
      return Boolean(content.fileUri || content.fileName);

    default:
      return false;
  }
}

/**
 * 剪贴板项目复制结果
 */
export interface CopyResult {
  success: boolean;
  message: string;
}

/**
 * 复制剪贴板项目到系统剪贴板
 * @param item 剪贴板项目（可以是 ClipboardContent 或 ClipboardItem）
 * @param clipboardManager 剪贴板管理器实例
 * @returns 复制结果
 */
export async function copyClipboardItem(
  item: {
    type: string;
    text?: string;
    fileUri?: string;
    profileHash?: string;
  },
  clipboardManager: {
    setClipboardContent: (content: ClipboardContent) => Promise<void>;
    setImageContent: (uri: string) => Promise<void>;
  }
): Promise<CopyResult> {
  try {
    if (item.type === 'Text' && !isTextInvalid(item.text)) {
      await clipboardManager.setClipboardContent({
        type: 'Text',
        text: item.text,
        profileHash: item.profileHash,
      });
      return { success: true, message: i18n.t('errors:copy.copied') };
    }

    if (item.type === 'Image' && item.fileUri) {
      await clipboardManager.setImageContent(item.fileUri);
      return { success: true, message: i18n.t('errors:copy.copiedImage') };
    }

    return { success: false, message: i18n.t('errors:copy.unsupportedType') };
  } catch (error) {
    log.error('Failed to copy:', error);

    // 提取错误信息
    let errorMessage = i18n.t('errors:copy.failed');
    if (error instanceof Error) {
      // 将整个错误转为字符串进行检查（包括多层堆栈）
      const fullErrorString = error.toString() + ' ' + error.message;
      log.info('Full error string:', fullErrorString);

      if (fullErrorString.includes('TransactionTooLargeException')) {
        errorMessage = i18n.t('errors:copy.textTooLarge');
      } else if (fullErrorString.includes('setStringAsync')) {
        // 提取更简洁的错误信息
        errorMessage = i18n.t('errors:copy.failedWithReason', {
          reason: error.message || i18n.t('errors:copy.unknownError'),
        });
      } else {
        errorMessage = error.message || i18n.t('errors:copy.failed');
      }
    }

    return { success: false, message: errorMessage };
  }
}

/**
 * 将内容写入系统剪贴板。
 * 只负责复制操作，不更新 Store。
 * 调用者负责在成功后更新 UI 状态。
 */
export async function copyToLocalClipboard(content: ClipboardContent): Promise<CopyResult> {
  const { clipboardManager, clipboardMonitor } = await import('@/features/clipboard');

  clipboardMonitor.pausePolling();
  try {
    let contentToCopy = content;
    if (content.type === 'Text' && content.fileUri && content.hasData) {
      try {
        const response = await fetch(content.fileUri);
        const completeText = await response.text();
        log.info(
          `Read complete local text for profileHash: ${content.profileHash}, length: ${completeText.length}`
        );
        contentToCopy = {
          ...content,
          text: completeText,
        };
      } catch (error) {
        log.error('Failed to read local text file:', error);
        if (isTextInvalid(content.text)) {
          return { success: false, message: i18n.t('errors:copy.cannotReadFullText') };
        }
      }
    }

    const result = await copyClipboardItem(contentToCopy, clipboardManager);
    if (result.success) {
      await clipboardMonitor.setLastContent(contentToCopy);
    }
    return result;
  } catch (error) {
    log.error('Failed to copy locally:', error);
    return { success: false, message: i18n.t('errors:copy.failed') };
  } finally {
    clipboardMonitor.resumePolling();
  }
}
