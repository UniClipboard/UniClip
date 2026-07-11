/**
 * 分享上传:落库不丢数据 + anti-echo 预置(import*ToHistory 本地优先)
 *
 * 回归:此前 uploadTextAndAddToHistory 先上传后落库,服务端 500 时 addItem 从未执行
 * → 分享文本丢失。迁移后落库(import*ToHistory)与推送(pushHistoryRecordViaEngine)
 * 彻底解耦:import* **不碰网络**,总是先把内容写为 LocalOnly 再返回 hash,推送失败只影响
 * 同步状态、绝不影响已落库内容。同时预置 lastUploadedHash 抑制自拉回环(anti-echo)。
 * 本用例锁定文本 + 文件两条落库路径的这两个结构性保证。
 */
import { Platform } from 'react-native';
import { HistorySyncStatus } from '@/types/clipboard';
import { importTextToHistory, importFileToHistory } from '@/utils/uploadFile';

// 变量名必须以 mock 前缀,jest.mock 工厂才允许引用(hoisting 规则)
const mockAddItem = jest.fn(async (item: unknown) => item);
const mockUpdateItem = jest.fn(async () => {});
const mockSetLastUploadedHash = jest.fn();

// uploadFile 顶层 import 了 heicToJpeg（→ expo-image-manipulator，测试环境无原生模块）;
// mock 掉避免加载真实原生模块,同时让文件路径按原样透传(不触发 HEIC 转换)。
jest.mock('@/utils/heicToJpeg', () => ({
  convertHeicToJpegIfNeeded: jest.fn(async (uri, fileName, mimeType, fileSize) => ({
    uri,
    fileName,
    mimeType,
    fileSize,
  })),
}));
// 全局 android-util mock 未导出 nativeCopyFile(importFileToHistory 的 android 落库路径需要)。
jest.mock('android-util', () => ({
  nativeCopyFile: jest.fn(async () => {}),
}));
jest.mock('@/services/SyncManager', () => ({
  SyncManager: { getInstance: () => ({ setLastUploadedHash: mockSetLastUploadedHash }) },
}));
jest.mock('@/utils/hash', () => ({
  calculateTextHash: jest.fn(async () => 'HASH_TEXT_ABC'),
  calculateFileProfileHash: jest.fn(async () => 'HASH_FILE_ABC'),
}));
jest.mock('@/stores/historyStore', () => ({
  useHistoryStore: { getState: () => ({ addItem: mockAddItem, updateItem: mockUpdateItem }) },
}));

describe('分享上传:import*ToHistory 本地优先,不丢数据 + anti-echo', () => {
  beforeEach(() => {
    mockAddItem.mockClear();
    mockUpdateItem.mockClear();
    mockSetLastUploadedHash.mockClear();
  });

  describe('文本 importTextToHistory', () => {
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
      // import 只负责落库,绝不在此标记 Synced(那是 push 成功后的事)
      expect(mockUpdateItem).not.toHaveBeenCalled();
    });

    it('预置 lastUploadedHash 以抑制自拉回环(anti-echo)', async () => {
      await importTextToHistory('正常文本');
      expect(mockSetLastUploadedHash).toHaveBeenCalledWith('HASH_TEXT_ABC');
    });
  });

  describe('文件 importFileToHistory', () => {
    // 强制 android 路径:走已 mock 的 nativeCopyFile,绕开 iOS 的 File.copy(MockFile 无此方法)。
    const originalOS = Platform.OS;
    beforeAll(() => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    });
    afterAll(() => {
      Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
    });

    it('落库即写为 LocalOnly 且预置 lastUploadedHash(文件路径同样不丢、anti-echo)', async () => {
      const result = await importFileToHistory(
        'file://src/photo.jpg',
        'photo.jpg',
        'image/jpeg',
        2048
      );

      expect(result.profileHash).toBe('HASH_FILE_ABC');
      expect(mockAddItem).toHaveBeenCalledTimes(1);
      expect(mockAddItem.mock.calls[0][0]).toMatchObject({
        type: 'Image',
        hasData: true,
        profileHash: 'HASH_FILE_ABC',
      });
      // 文件分享同样会 echo,落库时必须预置 lastUploadedHash
      expect(mockSetLastUploadedHash).toHaveBeenCalledWith('HASH_FILE_ABC');
    });
  });
});
