/**
 * Clipboard Manager
 * 剪贴板管理器 - 处理剪贴板读写操作
 */

import * as Clipboard from 'expo-clipboard';
import * as ClipboardProxy from '@/utils/clipboardProxy';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import { ClipboardContent } from '@/types';
import { calculateTextHash, calculateFileHash } from '@/utils/hash';
import { isTextInvalid } from '@/utils/index';
import { historyStorage } from './HistoryStorage';
import { prepareTempFilePath, CLIPBOARD_TEMP_DIR } from '@/utils/fileStorage';
import { nativeSetClipboardImageFromFile } from 'native-util';
import { log } from './Logger';
import i18n from '@/i18n';

/**
 * 剪贴板管理器类
 */
export class ClipboardManager {
  private lastProfileHash: string = '';
  private _imageReadFailedForState: boolean = false;
  private _lastImageHash: string | null = null;
  private _lastImageContent: ClipboardContent | null = null;

  /**
   * 获取当前剪贴板内容
   */
  async getClipboardContent(): Promise<ClipboardContent | null> {
    try {
      // Directly try getting text first (avoids extra overlay windows for type checks)
      const text = await ClipboardProxy.getStringAsync();
      if (text && text.length > 0) {
        this._imageReadFailedForState = false;
        return await this.getTextContentFromString(text);
      }

      // If no text, check for image
      const hasImage = await ClipboardProxy.hasImageAsync();
      if (hasImage) {
        return await this.getImageContent();
      }

      return null;
    } catch (error) {
      log.error('[ClipboardManager] Failed to get clipboard content:', error);
      return null;
    }
  }

  /**
   * 从已知文本构建剪贴板内容（含 hash/历史查询），不再读取系统剪贴板。
   * 供事件驱动监听器使用：原生侧已在悬浮窗焦点窗口内读到文本并 emit，
   * JS 直接复用该文本构建内容，避免二次抢焦点。
   */
  async buildTextContent(text: string): Promise<ClipboardContent> {
    return this.getTextContentFromString(text);
  }

  /**
   * 获取文本内容（从已获取的文本字符串构建）
   */
  private async getTextContentFromString(text: string): Promise<ClipboardContent> {
    const profileHash = await calculateTextHash(text);
    const timestamp = Date.now();

    // 步骤1: 根据 profileHash 查询历史记录
    let historyItem = await historyStorage.getItemByLocalHash(profileHash);

    if (historyItem && historyItem.type === 'Text') {
      // 如果历史记录有外部文件，验证文件是否存在
      if (historyItem.hasData && historyItem.dataName) {
        const { getHistoryFileUri } = await import('@/utils/fileStorage');
        const historyFileUri = await getHistoryFileUri(
          'Text',
          historyItem.profileHash,
          historyItem.dataName
        );

        if (historyFileUri) {
          const { File } = FileSystem;
          const historyFile = new File(historyFileUri);

          if (historyFile.exists) {
            // 生成预览文本：如果有历史文本则使用，否则从当前文本取前200字符
            let previewText = historyItem.text;
            if (!previewText) {
              previewText = text.length > 200 ? text.substring(0, 200) + '...' : text;
            }

            // 使用历史记录中的文件信息
            return {
              type: 'Text',
              text: previewText,
              fileUri: historyFile.uri,
              fileName: historyItem.dataName,
              fileSize: historyItem.size || text.length,
              profileHash: historyItem.profileHash,
              localClipboardHash: historyItem.profileHash, // 文本类型，两者相同
              hasData: true,
              timestamp,
            };
          }
        }
      } else {
        // 历史记录中的短文本，直接返回
        return {
          type: 'Text',
          text: historyItem.text || text,
          fileSize: historyItem.size || text.length,
          profileHash: historyItem.profileHash,
          localClipboardHash: historyItem.profileHash,
          hasData: false,
          timestamp,
        };
      }
    }

    // 历史记录中没有找到或文件不存在，继续处理
    // 文本长度阈值（字符数），超过此长度将保存为文件
    const TEXT_STORAGE_THRESHOLD = 1000;
    const TEXT_PREVIEW_MAX_LENGTH = 200;

    // 如果文本长度超过阈值，保存为文件
    if (text.length > TEXT_STORAGE_THRESHOLD) {
      try {
        // 生成文件名
        const fileName = `${profileHash}.txt`;
        const tempFile = new FileSystem.File(prepareTempFilePath(fileName));

        // 检查文件是否已存在
        if (!tempFile.exists) {
          // 文件不存在，保存完整文本到文件
          tempFile.write(new TextEncoder().encode(text));
          log.info(`[ClipboardManager] Text saved to file: ${fileName}, length: ${text.length}`);
        } else {
          // 文件已存在，直接使用
          log.info(
            `[ClipboardManager] Text file already exists: ${fileName}, length: ${text.length}`
          );
        }

        // 生成预览文本
        const previewText =
          text.length > TEXT_PREVIEW_MAX_LENGTH
            ? text.substring(0, TEXT_PREVIEW_MAX_LENGTH) + '...'
            : text;

        return {
          type: 'Text',
          text: previewText, // 只保存预览文本在内存中
          fileUri: tempFile.uri, // 文件路径
          fileName: fileName,
          fileSize: text.length,
          profileHash,
          localClipboardHash: profileHash, // 文本类型，profileHash 和 localClipboardHash 相同
          hasData: true, // 标记有外部文件
          timestamp,
        };
      } catch (error) {
        log.error('[ClipboardManager] Failed to save text to file:', error);
        // 出错时降级为普通文本处理
      }
    }

    // 短文本或保存失败时，直接返回
    return {
      type: 'Text',
      text,
      fileSize: text.length, // 设置文字数量
      profileHash,
      localClipboardHash: profileHash,
      hasData: false, // 短文本没有外部文件
      timestamp,
    };
  }

  /**
   * 获取图片内容
   * @param createTempFile 是否创建临时文件
   */
  private async getImageContent(): Promise<ClipboardContent> {
    try {
      const timestamp = Date.now();
      const { File } = FileSystem;

      // ========== 阶段1: Native 侧直接将剪贴板图片写入临时目录（不经过 JS 内存） ==========
      // Native 侧根据 mimeType 自动确定文件扩展名
      if (!CLIPBOARD_TEMP_DIR.exists) {
        CLIPBOARD_TEMP_DIR.create();
      }
      const saved = await ClipboardProxy.saveImageToFileAsync(CLIPBOARD_TEMP_DIR.uri);
      if (!saved) {
        throw new Error('No image data in clipboard');
      }
      const randomTempFilePath = saved.filePath;
      const imageExt = saved.mimeType.includes('png')
        ? 'png'
        : saved.mimeType.includes('jpeg') || saved.mimeType.includes('jpg')
          ? 'jpg'
          : saved.mimeType.includes('gif')
            ? 'gif'
            : saved.mimeType.includes('webp')
              ? 'webp'
              : 'png';

      // ========== 阶段2: 从文件计算 localClipboardHash ==========
      const localClipboardHash = await calculateFileHash(randomTempFilePath);

      // 早期去重：hash 未变则返回缓存结果，删除多余临时文件
      if (this._lastImageHash === localClipboardHash && this._lastImageContent) {
        try {
          new File(randomTempFilePath).delete();
        } catch {}
        return { ...this._lastImageContent, timestamp };
      }

      // 将随机命名的临时文件重命名为基于 hash 的确定性名称（便于去重）
      const hashTempFileName = `${localClipboardHash.substring(0, 16)}.${imageExt}`;
      let tempFilePath = prepareTempFilePath(hashTempFileName);
      const hashTempFile = new File(tempFilePath);
      if (hashTempFile.exists) {
        // 已有同内容文件，删除随机临时文件
        try {
          new File(randomTempFilePath).delete();
        } catch {}
      } else {
        // 重命名为 hash 命名
        try {
          new File(randomTempFilePath).move(hashTempFile);
        } catch {
          tempFilePath = randomTempFilePath;
        }
      }

      // ========== 阶段3: 基于文件进行后续操作 ==========

      // 根据 localClipboardHash 查询历史记录
      const historyItem = await historyStorage.getItemByLocalHash(localClipboardHash);

      if (historyItem && historyItem.hasData && historyItem.dataName) {
        // 从历史记录中获取文件路径
        const { getHistoryFileUri } = await import('@/utils/fileStorage');
        const historyFileUri = await getHistoryFileUri(
          'Image',
          historyItem.profileHash,
          historyItem.dataName
        );

        if (historyFileUri) {
          const historyFile = new File(historyFileUri);
          if (historyFile.exists) {
            const result: ClipboardContent = {
              type: 'Image',
              text: historyItem.dataName,
              fileUri: historyFile.uri,
              fileName: historyItem.dataName,
              fileSize: historyFile.size,
              profileHash: historyItem.profileHash,
              localClipboardHash,
              hasData: true,
              timestamp,
            };
            this._lastImageHash = localClipboardHash;
            this._lastImageContent = result;
            return result;
          }
        }
      }

      // 历史记录中没有找到，使用临时文件
      const tempFile = new File(tempFilePath);
      const fileUri = tempFile.uri;
      const fileSize = tempFile.size;

      // SyncClipboard 规范：Image 的 profileHash = 文件内容 SHA256（文件名不参与）
      // 与 iOS Clipboard.swift / 服务端 sync_clipboard_mapping.rs 对齐
      const profileHash = localClipboardHash;

      const result: ClipboardContent = {
        type: 'Image',
        text: tempFile.name,
        fileUri,
        fileName: tempFile.name,
        fileSize,
        profileHash,
        localClipboardHash,
        hasData: true,
        timestamp,
      };
      this._lastImageHash = localClipboardHash;
      this._lastImageContent = result;
      return result;
    } catch (error) {
      log.error('[ClipboardManager] Failed to get image:', error);
      throw new Error('Failed to get image from clipboard');
    }
  }

  /**
   * 设置文本到剪贴板
   */
  async setTextContent(text: string): Promise<void> {
    try {
      await ClipboardProxy.setStringAsync(text);

      // 计算并更新 localClipboardHash（用于本地变化检测）
      const localClipboardHash = await calculateTextHash(text);
      this.lastProfileHash = localClipboardHash;
    } catch (error) {
      log.error('[ClipboardManager] Failed to set text content:', error);

      // 保留原始错误信息，特别是 TransactionTooLargeException
      if (error instanceof Error) {
        throw error; // 直接抛出原始错误，保留详细信息
      }
      throw new Error('Failed to set text to clipboard');
    }
  }

  /**
   * 设置图片到剪贴板
   */
  async setImageContent(imageUri: string): Promise<void> {
    try {
      if (Platform.OS === 'ios') {
        // native-util 未提供 iOS 实现，改走 expo-clipboard（UIPasteboard）
        const { readAsStringAsync, EncodingType } = await import('expo-file-system/legacy');
        const base64 = await readAsStringAsync(imageUri, {
          encoding: EncodingType.Base64,
        });
        await Clipboard.setImageAsync(base64);
      } else {
        // Android：直接通过 native 将文件设置到系统剪贴板（不经过 JS 内存/base64）
        const success = await nativeSetClipboardImageFromFile(imageUri);
        if (!success) {
          throw new Error('Native setClipboardImageFromFile returned false');
        }
      }

      // 计算并更新 localClipboardHash（用于本地变化检测，与 getImageContent 保持一致使用文件内容 hash）
      const localClipboardHash = await calculateFileHash(imageUri);
      this.lastProfileHash = localClipboardHash;
    } catch (error) {
      log.error('[ClipboardManager] Failed to set image content:', error);
      throw new Error('Failed to set image to clipboard');
    }
  }

  /**
   * 设置剪贴板内容
   */
  async setClipboardContent(content: ClipboardContent): Promise<void> {
    switch (content.type) {
      case 'Text':
        if (!isTextInvalid(content.text)) {
          await this.setTextContent(content.text);
        }
        break;

      case 'Image':
        if (content.fileUri) {
          await this.setImageContent(content.fileUri);
        }
        break;

      case 'File':
      case 'Group':
        // 文件和文件组暂不支持直接设置到剪贴板
        // 可以设置文件路径或名称作为文本
        if (!isTextInvalid(content.text)) {
          await this.setTextContent(content.text);
        }
        break;

      default:
        throw new Error(`Unsupported clipboard type: ${content.type}`);
    }
  }

  /**
   * 清空剪贴板
   */
  async clearClipboard(): Promise<void> {
    try {
      await ClipboardProxy.setStringAsync('');
      this.lastProfileHash = '';
    } catch (error) {
      log.error('[ClipboardManager] Failed to clear clipboard:', error);
      throw new Error('Failed to clear clipboard');
    }
  }

  /**
   * 检查剪贴板内容是否发生变化
   */
  async hasClipboardChanged(): Promise<boolean> {
    try {
      const content = await this.getClipboardContent();
      if (!content || !content.profileHash) {
        return false;
      }

      const hasChanged = content.profileHash !== this.lastProfileHash;
      if (hasChanged) {
        this.lastProfileHash = content.profileHash;
      }

      return hasChanged;
    } catch (error) {
      log.error('[ClipboardManager] Failed to check clipboard change:', error);
      return false;
    }
  }

  /**
   * 获取上次记录的 profileHash
   */
  getLastProfileHash(): string {
    return this.lastProfileHash;
  }

  /**
   * 重置上次记录的 profileHash
   */
  resetLastProfileHash(): void {
    this.lastProfileHash = '';
    this._imageReadFailedForState = false;
    this._lastImageHash = null;
    this._lastImageContent = null;
  }

  /**
   * 从相册选择图片
   */
  async pickImageFromGallery(): Promise<ClipboardContent | null> {
    try {
      // 请求权限
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        throw new Error('Permission to access media library denied');
      }

      // 选择图片
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return null;
      }

      const asset = result.assets[0];
      const profileHash = await calculateTextHash(asset.uri);

      return {
        type: 'Image',
        text: i18n.t('errors:contentPlaceholder.image'),
        fileUri: asset.uri,
        fileSize: asset.fileSize,
        profileHash,
      };
    } catch (error) {
      log.error('[ClipboardManager] Failed to pick image:', error);
      return null;
    }
  }

  /**
   * 拍照
   */
  async takePhoto(): Promise<ClipboardContent | null> {
    try {
      // 请求权限
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        throw new Error('Permission to access camera denied');
      }

      // 拍照
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 1,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return null;
      }

      const asset = result.assets[0];
      const profileHash = await calculateTextHash(asset.uri);

      return {
        type: 'Image',
        text: i18n.t('errors:contentPlaceholder.image'),
        fileUri: asset.uri,
        fileSize: asset.fileSize,
        profileHash,
      };
    } catch (error) {
      log.error('[ClipboardManager] Failed to take photo:', error);
      return null;
    }
  }
}

// 导出单例
export const clipboardManager = new ClipboardManager();
