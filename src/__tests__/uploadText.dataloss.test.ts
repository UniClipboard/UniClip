/**
 * 分享文本:数据不丢的结构性保证(importTextToHistory 本地优先)
 *
 * 回归:此前 uploadTextAndAddToHistory 先上传后落库,服务端 500 时 addItem 从未执行
 * → 分享文本丢失。迁移后落库(importTextToHistory)与推送(pushHistoryRecordViaEngine)
 * 彻底解耦:importTextToHistory **不碰网络**,总是先把文本写为 LocalOnly 再返回 hash,
 * 推送失败只影响同步状态、绝不影响已落库内容。本用例锁定这条不丢数据的结构性保证。
 */
import { HistorySyncStatus } from '@/types/clipboard';
import { importTextToHistory } from '@/utils/uploadFile';

// 变量名必须以 mock 前缀,jest.mock 工厂才允许引用(hoisting 规则)
const mockAddItem = jest.fn(async (item: unknown) => item);
const mockUpdateItem = jest.fn(async () => {});
const mockSetLastUploadedHash = jest.fn();

// uploadFile 顶层 import 了 heicToJpeg（→ expo-image-manipulator，测试环境无原生模块）;
// importTextToHistory 不走 HEIC,mock 掉避免加载真实原生模块。
jest.mock('@/utils/heicToJpeg', () => ({
  convertHeicToJpegIfNeeded: jest.fn(async (uri, fileName, mimeType, fileSize) => ({
    uri,
    fileName,
    mimeType,
    fileSize,
  })),
}));
jest.mock('@/services/SyncManager', () => ({
  SyncManager: { getInstance: () => ({ setLastUploadedHash: mockSetLastUploadedHash }) },
}));
jest.mock('@/utils/hash', () => ({
  calculateTextHash: jest.fn(async () => 'HASH_TEXT_ABC'),
  calculateFileProfileHash: jest.fn(async () => 'HASH_FILE'),
}));
jest.mock('@/stores/historyStore', () => ({
  useHistoryStore: { getState: () => ({ addItem: mockAddItem, updateItem: mockUpdateItem }) },
}));

describe('分享文本:importTextToHistory 本地优先,不丢数据', () => {
  beforeEach(() => {
    mockAddItem.mockClear();
    mockUpdateItem.mockClear();
    mockSetLastUploadedHash.mockClear();
  });

  it('落库即写为 LocalOnly,不碰网络、不依赖任何 server 参数', async () => {
    const { profileHash } = await importTextToHistory('会因服务端异常丢失的文本');

    expect(profileHash).toBe('HASH_TEXT_ABC');
    // 关键:落库先于(且独立于)任何推送 → 即便后续 push 失败,内容已在本地
    expect(mockAddItem).toHaveBeenCalledTimes(1);
    expect(mockAddItem.mock.calls[0][0]).toMatchObject({
      type: 'Text',
      text: '会因服务端异常丢失的文本',
      profileHash: 'HASH_TEXT_ABC',
      syncStatus: HistorySyncStatus.LocalOnly,
    });
    // importTextToHistory 只负责落库,绝不在此标记 Synced(那是 push 成功后的事)
    expect(mockUpdateItem).not.toHaveBeenCalled();
  });

  it('预置 lastUploadedHash 以抑制自拉回环(anti-echo)', async () => {
    await importTextToHistory('正常文本');
    expect(mockSetLastUploadedHash).toHaveBeenCalledWith('HASH_TEXT_ABC');
  });
});
