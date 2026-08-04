describe('clipboardProxy iOS file reads', () => {
  const loadProxy = (clipboardUrl: string | null) => {
    jest.resetModules();

    const copy = jest.fn().mockResolvedValue(undefined);
    const source = {
      uri: 'file:///cache/shares/received-plan.txt',
      name: 'received-plan.txt',
      type: 'text/plain',
      size: 793,
      exists: true,
      copy,
    };
    const destination = {
      uri: 'file:///cache/temp_files/received-plan.txt',
      name: 'received-plan.txt',
      type: 'text/plain',
      size: 793,
      exists: false,
      delete: jest.fn(),
    };
    const createDirectory = jest.fn();

    jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
    jest.doMock('expo-clipboard', () => ({
      getUrlAsync: jest.fn().mockResolvedValue(clipboardUrl),
      getStringAsync: jest.fn(),
      setStringAsync: jest.fn(),
      hasStringAsync: jest.fn(),
      hasImageAsync: jest.fn(),
      getImageAsync: jest.fn(),
    }));
    jest.doMock('expo-file-system', () => ({
      Directory: jest.fn().mockImplementation(() => ({
        exists: false,
        create: createDirectory,
      })),
      File: jest
        .fn()
        .mockImplementation((first: unknown, second?: string) => (second ? destination : source)),
    }));
    jest.doMock('@/utils/androidBackgroundClipboardAccess', () => ({
      getBackgroundClipboardAdapter: jest.fn(() => null),
    }));
    jest.doMock('@/support/observability', () => ({
      createLogger: () => ({ warn: jest.fn() }),
    }));
    jest.doMock('android-util', () => ({
      nativeSaveClipboardImageToFile: jest.fn(),
      nativeGetClipboardFileSourceId: jest.fn(),
      nativeSaveClipboardFileToFile: jest.fn(),
    }));

    return {
      proxy: require('@/utils/clipboardProxy') as typeof import('@/utils/clipboardProxy'),
      copy,
      destination,
      createDirectory,
    };
  };

  afterEach(() => jest.resetModules());

  it('copies an iOS clipboard file URL into the requested temporary directory', async () => {
    const { proxy, copy, destination, createDirectory } = loadProxy(
      'file:///cache/shares/received-plan.txt'
    );

    await expect(proxy.getFileSourceIdAsync()).resolves.toBe(
      'file:///cache/shares/received-plan.txt'
    );
    await expect(proxy.saveFileToFileAsync('file:///cache/temp_files')).resolves.toEqual({
      filePath: destination.uri,
      displayName: 'received-plan.txt',
      mimeType: 'text/plain',
      size: 793,
      sourceId: 'file:///cache/shares/received-plan.txt',
    });

    expect(createDirectory).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenCalledWith(destination);
  });

  it('does not treat an ordinary web URL as a clipboard file', async () => {
    const { proxy } = loadProxy('https://example.com/received-plan.txt');

    await expect(proxy.getFileSourceIdAsync()).resolves.toBeNull();
    await expect(proxy.saveFileToFileAsync('file:///cache/temp_files')).resolves.toBeNull();
  });
});
