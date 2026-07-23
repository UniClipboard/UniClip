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

import { ClipboardManager } from '../services/ClipboardManager';
import { Platform } from 'react-native';

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
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
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
