const mockNativeModule = {
  resolveBackgroundClipboardRestriction: jest.fn().mockResolvedValue(true),
};

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('expo-modules-core', () => ({
  requireNativeModule: jest.fn(() => mockNativeModule),
}));

describe('shizuku clipboard module', () => {
  beforeEach(() => jest.clearAllMocks());

  it('resolves the MIUI clipboard restriction through the native service', async () => {
    const { resolveBackgroundClipboardRestriction } =
      require('./index') as typeof import('./index');

    await expect(resolveBackgroundClipboardRestriction()).resolves.toBe(true);
    expect(mockNativeModule.resolveBackgroundClipboardRestriction).toHaveBeenCalledTimes(1);
  });
});
