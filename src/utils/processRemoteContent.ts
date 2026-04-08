/**
 * processRemoteContent
 * 提取自 HomeScreen.processRemoteClipboardContent 的核心逻辑，
 * 用于解析远程剪贴板内容并关联本地历史记录中的文件。
 */

import type { ClipboardContent } from '@/types/clipboard';
import { compareHash } from '@/utils/hash';

/**
 * 依赖注入接口，方便测试
 */
export interface ProcessRemoteContentDeps {
  getLastUploadedHash: () => string | null;
  getHistoryItem: (profileHash: string) => Promise<{ fileUri?: string } | null>;
  getHistoryFileUri: (
    type: string,
    profileHash: string,
    fileName: string
  ) => Promise<string | null>;
}

export interface ProcessRemoteContentResult {
  /** 最终要显示的内容（可能已包含来自历史记录的 fileUri） */
  content: ClipboardContent;
  /** 是否为刚刚上传的内容 */
  isJustUploaded: boolean;
  /** 是否从历史记录中找到了本地文件 */
  foundInHistory: boolean;
}

/**
 * 解析远程剪贴板内容，关联本地历史记录中的文件路径。
 *
 * @returns null 表示内容无变化无需处理；否则返回处理后的结果
 */
export async function resolveRemoteContent(
  content: ClipboardContent,
  currentHash: string,
  previousHash: string | null,
  hasData: boolean,
  deps: ProcessRemoteContentDeps
): Promise<ProcessRemoteContentResult | null> {
  // 没有变化，不处理
  if (previousHash === currentHash) {
    return null;
  }

  // 检查是否是本地刚上传的内容
  const lastUploadedHash = deps.getLastUploadedHash();
  const isJustUploaded = !!(lastUploadedHash && compareHash(currentHash, lastUploadedHash));

  // 检查历史记录中是否存在相同 profileHash 的记录（含刚上传的内容）
  let finalContent = content;
  let foundInHistory = false;

  if (hasData && content.profileHash) {
    try {
      const historyItem = await deps.getHistoryItem(content.profileHash);
      if (historyItem) {
        const fileUri = await deps.getHistoryFileUri(
          content.type,
          content.profileHash!,
          content.fileName!
        );
        if (fileUri) {
          finalContent = { ...content, fileUri };
          foundInHistory = true;
        }
      }
    } catch {
      // 出错时继续使用原始 content
    }
  }

  if (isJustUploaded) {
    return {
      content: finalContent,
      isJustUploaded: true,
      foundInHistory,
    };
  }

  return {
    content: finalContent,
    isJustUploaded: false,
    foundInHistory,
  };
}
