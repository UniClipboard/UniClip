describe('fileStorage App Group compatibility', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.doMock('../services/Logger', () => ({
      log: {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
      },
    }));
  });

  it('uses App Group payload files for iOS history payload lookups', async () => {
    jest.doMock('react-native', () => ({
      Platform: { OS: 'ios' },
    }));
    jest.doMock('app-group-store', () => ({
      getPayloadFileUri: jest.fn().mockResolvedValue('file:///group/payloads/Image-ABC'),
    }));
    jest.doMock('expo-file-system', () => ({
      Paths: { document: 'file:///documents', cache: 'file:///cache' },
      Directory: jest.fn().mockImplementation((_base: unknown, name?: string) => ({
        exists: true,
        uri: `file:///documents/${name ?? ''}`,
        create: jest.fn(),
        delete: jest.fn(),
        list: jest.fn(() => []),
      })),
      File: jest.fn().mockImplementation((_dir: unknown, name?: string) => ({
        exists: false,
        uri: `file:///documents/${name ?? ''}`,
        write: jest.fn(),
        delete: jest.fn(),
        info: jest.fn(() => ({ size: 0 })),
      })),
    }));

    const { getPayloadFileUri } = require('app-group-store');
    const { getHistoryFileUri } = require('../utils/fileStorage.ios');

    await expect(getHistoryFileUri('Image', 'ABC', 'image.png')).resolves.toBe(
      'file:///group/payloads/Image-ABC'
    );
    expect(getPayloadFileUri).toHaveBeenCalledWith('Image-ABC');
  });

  it('prepares iOS history downloads in the App Group payload directory', async () => {
    jest.doMock('react-native', () => ({
      Platform: { OS: 'ios' },
    }));
    jest.doMock('app-group-store', () => ({
      getContainerUrl: jest.fn().mockResolvedValue('file:///group'),
      getPayloadFileUri: jest.fn().mockResolvedValue(null),
    }));
    jest.doMock('expo-file-system', () => ({
      Paths: { document: 'file:///documents', cache: 'file:///cache' },
      Directory: jest.fn().mockImplementation((_base: unknown, name?: string) => ({
        exists: true,
        uri: `file:///documents/${name ?? ''}`,
        create: jest.fn(),
        delete: jest.fn(),
        list: jest.fn(() => []),
      })),
      File: jest.fn().mockImplementation((_dir: unknown, name?: string) => ({
        exists: false,
        uri: `file:///documents/${name ?? ''}`,
        write: jest.fn(),
        delete: jest.fn(),
        info: jest.fn(() => ({ size: 0 })),
      })),
    }));

    const { getPayloadFileUri } = require('app-group-store');
    const { prepareHistoryFileUri } = require('../utils/fileStorage.ios');

    await expect(prepareHistoryFileUri('Image', 'ABC', 'image.png')).resolves.toBe(
      'file:///group/payloads/Image-ABC'
    );
    expect(getPayloadFileUri).toHaveBeenCalledWith('Image-ABC');
  });

  it('writes iOS history payload bytes to the App Group payload cache', async () => {
    jest.doMock('react-native', () => ({
      Platform: { OS: 'ios' },
    }));
    jest.doMock('app-group-store', () => ({
      writePayload: jest.fn().mockResolvedValue('file:///group/payloads/Image-ABC'),
    }));
    jest.doMock('expo-file-system', () => ({
      Paths: { document: 'file:///documents', cache: 'file:///cache' },
      Directory: jest.fn().mockImplementation((_base: unknown, name?: string) => ({
        exists: true,
        uri: `file:///documents/${name ?? ''}`,
        create: jest.fn(),
        delete: jest.fn(),
        list: jest.fn(() => []),
      })),
      File: jest.fn().mockImplementation((_dir: unknown, name?: string) => ({
        exists: false,
        uri: `file:///documents/${name ?? ''}`,
        write: jest.fn(),
        delete: jest.fn(),
        info: jest.fn(() => ({ size: 0 })),
      })),
    }));

    const { writePayload } = require('app-group-store');
    const { saveHistoryFile } = require('../utils/fileStorage.ios');

    await expect(
      saveHistoryFile('Image', 'ABC', 'image.png', new Uint8Array([1, 2]).buffer)
    ).resolves.toBe('file:///group/payloads/Image-ABC');
    expect(writePayload).toHaveBeenCalledWith('Image-ABC', new Uint8Array([1, 2]));
  });

  it('clears iOS history from the shared App Group payload cache', async () => {
    jest.doMock('react-native', () => ({
      Platform: { OS: 'ios' },
    }));
    jest.doMock('app-group-store', () => ({
      clearPayloads: jest.fn().mockResolvedValue(undefined),
    }));
    jest.doMock('expo-file-system', () => ({
      Paths: { document: 'file:///documents', cache: 'file:///cache' },
      Directory: jest.fn().mockImplementation((_base: unknown, name?: string) => ({
        exists: true,
        uri: `file:///documents/${name ?? ''}`,
        create: jest.fn(),
        delete: jest.fn(),
        list: jest.fn(() => []),
      })),
      File: jest.fn(),
    }));

    const { clearPayloads } = require('app-group-store');
    const { clearHistoryFiles } = require('../utils/fileStorage.ios');

    await expect(clearHistoryFiles()).resolves.toBeUndefined();
    expect(clearPayloads).toHaveBeenCalledTimes(1);
  });

  it('reports iOS history size from the shared App Group payload cache', async () => {
    jest.doMock('app-group-store', () => ({
      getPayloadStats: jest.fn().mockResolvedValue({ count: 2, totalSize: 3456 }),
    }));
    jest.doMock('expo-file-system', () => ({
      Paths: { document: 'file:///documents', cache: 'file:///cache' },
      Directory: jest.fn(),
      File: jest.fn(),
    }));

    const { getHistoryStorageSize } = require('../utils/fileStorage.ios');

    await expect(getHistoryStorageSize()).resolves.toBe(3456);
  });

  it('keeps Android history payload lookups in the Expo document directory', async () => {
    jest.doMock('react-native', () => ({
      Platform: { OS: 'android' },
    }));
    jest.doMock('app-group-store', () => ({
      getPayloadFileUri: jest.fn(),
    }));

    const fileConstructor = jest.fn().mockImplementation((_dir: unknown, name?: string) => ({
      exists: true,
      uri: `file:///documents/clipboards/history/Image-ABC/${name ?? ''}`,
      write: jest.fn(),
      delete: jest.fn(),
      info: jest.fn(() => ({ size: 0 })),
    }));
    jest.doMock('expo-file-system', () => ({
      Paths: { document: 'file:///documents', cache: 'file:///cache' },
      Directory: jest.fn().mockImplementation((_base: unknown, name?: string) => ({
        exists: true,
        uri: name
          ? `file:///documents/clipboards/history/${name}`
          : 'file:///documents/clipboards/history',
        create: jest.fn(),
        delete: jest.fn(),
        list: jest.fn(() => []),
      })),
      File: fileConstructor,
    }));

    const { getPayloadFileUri } = require('app-group-store');
    const { getHistoryFileUri } = require('../utils/fileStorage.android');

    await expect(getHistoryFileUri('Image', 'ABC', 'image.png')).resolves.toBe(
      'file:///documents/clipboards/history/Image-ABC/image.png'
    );
    expect(getPayloadFileUri).not.toHaveBeenCalled();
  });
});
