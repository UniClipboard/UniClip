const mockReadAsStringAsync = jest.fn();
const mockFileInfo = jest.fn();

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({
    info: (...args: unknown[]) => mockFileInfo(...args),
  })),
}));

jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  readAsStringAsync: (...args: unknown[]) => mockReadAsStringAsync(...args),
}));

jest.mock('android-util', () => ({
  isNativeHashModuleAvailable: false,
  nativeCalculateFileHash: jest.fn(),
}));

jest.mock('@/support/observability', () => ({
  createLogger: () => ({ debug: jest.fn(), error: jest.fn(), warn: jest.fn() }),
}));

import { calculateFileHash } from '../utils/hash';

describe('calculateFileHash on iOS', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFileInfo.mockImplementation(() => {
      throw new TypeError("Cannot read property 'reload' of undefined");
    });
    mockReadAsStringAsync.mockResolvedValue('YWJj');
  });

  it('falls back to the compatible reader when the modern file reader is unavailable', async () => {
    await expect(calculateFileHash('file:///cache/shared-image.png')).resolves.toBe(
      'BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD'
    );

    expect(mockReadAsStringAsync).toHaveBeenCalledWith('file:///cache/shared-image.png', {
      encoding: 'base64',
    });
  });
});
