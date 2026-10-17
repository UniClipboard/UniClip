const mockGetStringAsync = jest.fn();
const mockHasImageAsync = jest.fn();
const mockGetFileSourceIdAsync = jest.fn();
const mockSaveFileToFileAsync = jest.fn();
const mockCalculateFileHash = jest.fn();

jest.mock('expo-image-picker', () => ({}));

jest.mock('../utils/clipboardProxy', () => ({
  getStringAsync: (...args: unknown[]) => mockGetStringAsync(...args),
  hasImageAsync: (...args: unknown[]) => mockHasImageAsync(...args),
  getFileSourceIdAsync: (...args: unknown[]) => mockGetFileSourceIdAsync(...args),
  saveImageToFileAsync: jest.fn(),
  saveFileToFileAsync: (...args: unknown[]) => mockSaveFileToFileAsync(...args),
}));

jest.mock('../utils/hash', () => ({
  calculateTextHash: jest.fn(),
  calculateFileHash: (...args: unknown[]) => mockCalculateFileHash(...args),
}));

import { ClipboardManager } from '../features/clipboard/internal/clipboardManager';
import { historyStorage } from '../features/history';
import { Platform } from 'react-native';
import { File } from 'expo-file-system';

describe('ClipboardManager file reads', () => {
  const originalPlatform = Platform.OS;

  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    jest.clearAllMocks();
    mockGetStringAsync.mockResolvedValue('');
    mockHasImageAsync.mockResolvedValue(false);
    mockGetFileSourceIdAsync.mockResolvedValue('content://uc-engine/received-plan');
    mockSaveFileToFileAsync.mockResolvedValue({
      filePath: 'file://cache/temp_files/received-plan.txt',
      displayName: 'received-plan.txt',
      mimeType: 'text/plain',
      size: 793,
      sourceId: 'content://uc-engine/received-plan',
    });
    mockCalculateFileHash.mockResolvedValue('FILE_HASH');
    jest.spyOn(historyStorage, 'getItemByLocalHash').mockResolvedValue(null);
    (File as unknown as { existsMock: jest.Mock }).existsMock.mockReturnValue(true);
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
    jest.restoreAllMocks();
  });

  it('turns a clipboard file into content that can be stored in history', async () => {
    const manager = new ClipboardManager();

    await expect(manager.getClipboardContent()).resolves.toEqual(
      expect.objectContaining({
        type: 'File',
        text: 'received-plan.txt',
        fileUri: 'file://cache/temp_files/received-plan.txt',
        fileName: 'received-plan.txt',
        fileSize: 793,
        profileHash: 'FILE_HASH',
        localClipboardHash: 'FILE_HASH',
        hasData: true,
      })
    );

    expect(mockSaveFileToFileAsync).toHaveBeenCalledTimes(1);
    expect(mockCalculateFileHash).toHaveBeenCalledWith('file://cache/temp_files/received-plan.txt');
  });

  it('keeps a text file as a file when clipboard text coercion returns its contents', async () => {
    mockGetStringAsync.mockResolvedValue('plain text file contents');
    const manager = new ClipboardManager();

    await expect(manager.getClipboardContent()).resolves.toEqual(
      expect.objectContaining({
        type: 'File',
        fileName: 'received-plan.txt',
        localClipboardHash: 'FILE_HASH',
      })
    );

    expect(mockSaveFileToFileAsync).toHaveBeenCalledTimes(1);
  });

  it('keeps an iOS file URL as a file when clipboard text coercion returns the URL', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    mockGetStringAsync.mockResolvedValue('file://cache/shares/received-plan.txt');
    const manager = new ClipboardManager();

    await expect(manager.getClipboardContent()).resolves.toEqual(
      expect.objectContaining({
        type: 'File',
        fileName: 'received-plan.txt',
        localClipboardHash: 'FILE_HASH',
      })
    );

    expect(mockGetFileSourceIdAsync).toHaveBeenCalledTimes(1);
    expect(mockSaveFileToFileAsync).toHaveBeenCalledTimes(1);
  });

  it('does not copy or hash the same clipboard file on every polling tick', async () => {
    const manager = new ClipboardManager();

    const first = await manager.getClipboardContent();
    const second = await manager.getClipboardContent();

    expect(first?.localClipboardHash).toBe('FILE_HASH');
    expect(second?.localClipboardHash).toBe('FILE_HASH');
    expect(mockGetFileSourceIdAsync).toHaveBeenCalledTimes(2);
    expect(mockSaveFileToFileAsync).toHaveBeenCalledTimes(1);
    expect(mockCalculateFileHash).toHaveBeenCalledTimes(1);
  });

  it('uses the persisted history file URI when collision-safe storage changed its name', async () => {
    jest.spyOn(historyStorage, 'getItemByLocalHash').mockResolvedValue({
      type: 'File',
      hasData: true,
      dataName: 'received-plan.txt',
      profileHash: 'PROFILE_HASH',
      fileUri: 'file://documents/history/File/PROFILE_HASH/uuid-received-plan.txt',
      size: 901,
    } as never);
    const manager = new ClipboardManager();

    await expect(manager.getClipboardContent()).resolves.toEqual(
      expect.objectContaining({
        fileUri: 'file://documents/history/File/PROFILE_HASH/uuid-received-plan.txt',
        fileName: 'received-plan.txt',
        fileSize: 901,
      })
    );
  });

  it('refreshes cached clipboard content from the latest persisted history URI', async () => {
    const getHistoryItem = jest.spyOn(historyStorage, 'getItemByLocalHash');
    getHistoryItem
      .mockResolvedValueOnce({
        type: 'File',
        hasData: true,
        dataName: 'received-plan.txt',
        profileHash: 'PROFILE_HASH',
        fileUri: 'file://documents/history/File/PROFILE_HASH/old-received-plan.txt',
      } as never)
      .mockResolvedValue({
        type: 'File',
        hasData: true,
        dataName: 'received-plan.txt',
        profileHash: 'PROFILE_HASH',
        fileUri: 'file://documents/history/File/PROFILE_HASH/new-received-plan.txt',
      } as never);
    const manager = new ClipboardManager();

    await manager.getClipboardContent();
    const cached = await manager.getClipboardContent();

    expect(cached?.fileUri).toBe(
      'file://documents/history/File/PROFILE_HASH/new-received-plan.txt'
    );
    expect(mockSaveFileToFileAsync).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent reads of the same clipboard file', async () => {
    const manager = new ClipboardManager();

    await Promise.all([manager.getClipboardContent(), manager.getClipboardContent()]);

    expect(mockSaveFileToFileAsync).toHaveBeenCalledTimes(1);
    expect(mockCalculateFileHash).toHaveBeenCalledTimes(1);
  });

  it('reads the file again after the clipboard leaves and re-enters the file state', async () => {
    const manager = new ClipboardManager();

    await manager.getClipboardContent();
    mockGetFileSourceIdAsync.mockResolvedValueOnce(null);
    await manager.getClipboardContent();
    await manager.getClipboardContent();

    expect(mockSaveFileToFileAsync).toHaveBeenCalledTimes(2);
    expect(mockCalculateFileHash).toHaveBeenCalledTimes(2);
  });
});
