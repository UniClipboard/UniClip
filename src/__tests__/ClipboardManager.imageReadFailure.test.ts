const mockLogError = jest.fn();
const mockGetStringAsync = jest.fn();
const mockHasImageAsync = jest.fn();
const mockGetFileSourceIdAsync = jest.fn();
const mockSaveImageToFileAsync = jest.fn();
const mockSaveFileToFileAsync = jest.fn();

jest.mock('expo-image-picker', () => ({}));

jest.mock('../services/Logger', () => ({
  log: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: (...args: unknown[]) => mockLogError(...args),
  },
}));

jest.mock('../utils/clipboardProxy', () => ({
  getStringAsync: (...args: unknown[]) => mockGetStringAsync(...args),
  hasImageAsync: (...args: unknown[]) => mockHasImageAsync(...args),
  getFileSourceIdAsync: (...args: unknown[]) => mockGetFileSourceIdAsync(...args),
  saveImageToFileAsync: (...args: unknown[]) => mockSaveImageToFileAsync(...args),
  saveFileToFileAsync: (...args: unknown[]) => mockSaveFileToFileAsync(...args),
}));

import { ClipboardManager } from '../services/ClipboardManager';

describe('ClipboardManager image read failures', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStringAsync.mockResolvedValue('');
    mockHasImageAsync.mockResolvedValue(true);
    mockGetFileSourceIdAsync.mockResolvedValue(null);
    mockSaveImageToFileAsync.mockRejectedValue(new Error('native image export failed'));
    mockSaveFileToFileAsync.mockResolvedValue(null);
  });

  it('logs one useful error for a repeated failure episode and keeps retrying reads', async () => {
    const manager = new ClipboardManager();

    await expect(manager.getClipboardContent()).resolves.toBeNull();
    await expect(manager.getClipboardContent()).resolves.toBeNull();

    expect(mockSaveImageToFileAsync).toHaveBeenCalledTimes(2);
    expect(mockLogError).toHaveBeenCalledTimes(1);
    expect(mockLogError).toHaveBeenCalledWith(
      '[ClipboardManager] Failed to get image:',
      'native image export failed'
    );
  });

  it('logs again after the clipboard leaves the failing image state', async () => {
    const manager = new ClipboardManager();

    await manager.getClipboardContent();
    mockHasImageAsync.mockResolvedValueOnce(false);
    await manager.getClipboardContent();
    mockHasImageAsync.mockResolvedValue(true);
    await manager.getClipboardContent();

    expect(mockLogError).toHaveBeenCalledTimes(2);
  });
});
