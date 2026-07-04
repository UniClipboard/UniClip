/**
 * 分享文本:服务端异常不丢数据(uploadTextAndAddToHistory 本地优先)
 *
 * 回归:此前 uploadTextAndAddToHistory 先上传后落库,服务端返回 500 时
 * addItem 从未执行 → 分享的文本丢失。修复为「先本地落库(LocalOnly),再上传」,
 * 与图片/文件分享路径一致,上传失败也不丢内容。
 */
import type { ServerConfig } from '@/types/api';
import { HistorySyncStatus } from '@/types/clipboard';
import { createAPIClient } from '@/services';
import { uploadTextAndAddToHistory } from '@/utils/uploadFile';

// 变量名必须以 mock 前缀,jest.mock 工厂才允许引用(hoisting 规则)
const mockAddItem = jest.fn(async (item: unknown) => item);
const mockUpdateItem = jest.fn(async () => {});

jest.mock('@/utils/heicToJpeg', () => ({
  convertHeicToJpegIfNeeded: jest.fn(async (uri, fileName, mimeType, fileSize) => ({
    uri,
    fileName,
    mimeType,
    fileSize,
  })),
}));
jest.mock('@/services', () => ({ createAPIClient: jest.fn() }));
jest.mock('@/services/SyncManager', () => ({
  SyncManager: { getInstance: () => ({ setLastUploadedHash: jest.fn() }) },
}));
jest.mock('@/utils/hash', () => ({
  calculateTextHash: jest.fn(async () => 'HASH_TEXT_ABC'),
  calculateFileProfileHash: jest.fn(async () => 'HASH_FILE'),
}));
jest.mock('@/stores/historyStore', () => ({
  useHistoryStore: { getState: () => ({ addItem: mockAddItem, updateItem: mockUpdateItem }) },
}));

const server = { id: 's1', url: 'http://localhost:1', name: 'test' } as unknown as ServerConfig;

describe('分享文本:服务端异常不丢数据', () => {
  beforeEach(() => {
    mockAddItem.mockClear();
    mockUpdateItem.mockClear();
  });

  it('上传返回 500 时:仍先本地落库(addItem 为 LocalOnly),内容不丢;不标记 Synced', async () => {
    (createAPIClient as jest.Mock).mockReturnValue({
      putContent: jest.fn().mockRejectedValue(new Error('status=500')),
    });

    await expect(
      uploadTextAndAddToHistory('会因服务端异常丢失的文本', server)
    ).rejects.toThrow();

    // 关键:addItem 在上传之前已执行 → 数据已本地保存
    expect(mockAddItem).toHaveBeenCalledTimes(1);
    expect(mockAddItem.mock.calls[0][0]).toMatchObject({
      type: 'Text',
      text: '会因服务端异常丢失的文本',
      profileHash: 'HASH_TEXT_ABC',
      syncStatus: HistorySyncStatus.LocalOnly,
    });
    // 上传失败 → 不应标记为已同步
    expect(mockUpdateItem).not.toHaveBeenCalled();
  });

  it('上传成功时:先 addItem(LocalOnly),后 updateItem(Synced)', async () => {
    const putContent = jest.fn().mockResolvedValue(undefined);
    (createAPIClient as jest.Mock).mockReturnValue({ putContent });

    await uploadTextAndAddToHistory('正常文本', server);

    expect(mockAddItem).toHaveBeenCalledTimes(1);
    expect(mockAddItem.mock.calls[0][0]).toMatchObject({
      syncStatus: HistorySyncStatus.LocalOnly,
    });
    expect(putContent).toHaveBeenCalledTimes(1);
    expect(mockUpdateItem).toHaveBeenCalledWith('HASH_TEXT_ABC', {
      syncStatus: HistorySyncStatus.Synced,
    });
  });
});
