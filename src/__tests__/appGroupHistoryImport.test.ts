import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLegacyHistory, getPayloadFileUri, migrateLegacyContainer } from 'app-group-store';
import { HistoryStorage } from '../services/HistoryStorage';
import { HistorySyncStatus } from '../types/clipboard';
import { STORAGE_KEYS } from '../types/storage';

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  const next = Object.create(actual);
  Object.defineProperty(next, 'Platform', {
    value: {
      ...actual.Platform,
      OS: 'ios',
    },
  });
  return next;
});

jest.mock('app-group-store', () => ({
  getLegacyHistory: jest.fn().mockResolvedValue(null),
  getPayloadFileUri: jest.fn().mockResolvedValue(null),
  migrateLegacyContainer: jest.fn().mockResolvedValue({ migrated: false, keys: 0 }),
}));

jest.mock('expo-file-system', () => ({
  Paths: { document: 'file:///documents', cache: 'file:///cache' },
  File: jest.fn().mockImplementation((pathOrDir: unknown, name?: string) => ({
    exists: false,
    uri: name ? `file://test/${name}` : String(pathOrDir),
    move: jest.fn(),
    write: jest.fn(),
    delete: jest.fn(),
    info: jest.fn(() => ({ size: 0 })),
  })),
  Directory: jest.fn().mockImplementation(() => ({
    exists: true,
    create: jest.fn(),
    delete: jest.fn(),
    list: jest.fn(() => []),
    uri: 'file://test/history',
  })),
}));

jest.mock('../services/ConfigStorage', () => ({
  configStorage: {
    getConfig: jest.fn().mockResolvedValue({ maxHistoryItems: 1000 }),
  },
}));

jest.mock('../services/Logger', () => ({
  log: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;
const mockGetLegacyHistory = getLegacyHistory as jest.Mock;
const mockGetPayloadFileUri = getPayloadFileUri as jest.Mock;
const mockMigrateLegacyContainer = migrateLegacyContainer as jest.Mock;
const APP_GROUP_HISTORY_IMPORT_KEY = '@syncclipboard:history:appgroup-imported';

describe('App Group history import', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (HistoryStorage as unknown as { instance: null }).instance = null;
    mockGetItem.mockResolvedValue(null);
    mockSetItem.mockResolvedValue(undefined);
    mockGetLegacyHistory.mockResolvedValue(null);
    mockGetPayloadFileUri.mockResolvedValue(null);
    mockMigrateLegacyContainer.mockResolvedValue({ migrated: false, keys: 0 });
  });

  it('imports native App Group history when RN history is empty', async () => {
    mockGetLegacyHistory.mockResolvedValue(
      JSON.stringify([
        {
          id: '4A482F3A-585D-4FAD-AF4D-7E5C7E979DAA',
          entry: {
            type: 'Image',
            hash: 'ABCDEF',
            text: 'image.png',
            hasData: true,
            dataName: 'image.png',
            size: 42,
          },
          timestamp: 785548800,
          direction: 'pulled',
        },
        {
          id: '8604E01F-7555-4872-B315-44022A252327',
          entry: {
            type: 'Text',
            hash: 'TEXT01',
            text: 'hello',
            hasData: false,
            size: 5,
          },
          timestamp: 1700000100000,
          direction: 'local',
        },
      ])
    );
    mockGetPayloadFileUri.mockImplementation((profileId: string) =>
      profileId === 'Image-ABCDEF' ? Promise.resolve('file:///group/payloads/Image-ABCDEF') : null
    );

    const storage = HistoryStorage.getInstance();
    await storage.initialize();

    expect(mockMigrateLegacyContainer).toHaveBeenCalled();
    const items = await storage.getAllItems();
    expect(items).toHaveLength(2);
    expect(items.find((item) => item.profileHash === 'TEXT01')).toEqual(
      expect.objectContaining({
        type: 'Text',
        profileHash: 'TEXT01',
        text: 'hello',
        syncStatus: HistorySyncStatus.LocalOnly,
        isLocalFileReady: true,
      })
    );
    expect(items.find((item) => item.profileHash === 'ABCDEF')).toEqual(
      expect.objectContaining({
        type: 'Image',
        profileHash: 'ABCDEF',
        dataName: 'image.png',
        hasData: true,
        hasRemoteData: true,
        fileUri: 'file:///group/payloads/Image-ABCDEF',
        syncStatus: HistorySyncStatus.Synced,
        from: 'server',
        isLocalFileReady: true,
      })
    );
    expect(mockSetItem).toHaveBeenCalledWith(STORAGE_KEYS.HISTORY, expect.any(String));
  });

  it('does not import native App Group history again after it already checked once', async () => {
    mockGetItem.mockImplementation((key: string) =>
      Promise.resolve(key === APP_GROUP_HISTORY_IMPORT_KEY ? '1' : null)
    );

    const storage = HistoryStorage.getInstance();
    await storage.initialize();

    expect(mockGetLegacyHistory).not.toHaveBeenCalled();
  });

  it('repairs imported image records that were saved before payloads were migrated', async () => {
    mockGetItem.mockImplementation((key: string) => {
      if (key === APP_GROUP_HISTORY_IMPORT_KEY) return Promise.resolve('1');
      if (key === STORAGE_KEYS.HISTORY) {
        return Promise.resolve(
          JSON.stringify([
            {
              type: 'Image',
              text: 'image.png',
              profileHash: 'ABCDEF',
              hasData: true,
              dataName: 'image.png',
              size: 42,
              timestamp: 1700000100000,
              starred: false,
              syncStatus: HistorySyncStatus.Synced,
              version: 0,
              lastModified: 1700000100000,
              lastAccessed: 1700000100000,
              isDeleted: false,
              pinned: false,
              isLocalFileReady: false,
              hasRemoteData: true,
            },
          ])
        );
      }
      return Promise.resolve(null);
    });
    mockGetPayloadFileUri.mockImplementation((profileId: string) =>
      profileId === 'Image-ABCDEF' ? Promise.resolve('file:///group/payloads/Image-ABCDEF') : null
    );

    const storage = HistoryStorage.getInstance();
    await storage.initialize();

    const items = await storage.getAllItems();
    expect(items[0]).toEqual(
      expect.objectContaining({
        fileUri: 'file:///group/payloads/Image-ABCDEF',
        isLocalFileReady: true,
      })
    );
    expect(mockMigrateLegacyContainer).toHaveBeenCalled();
    expect(mockSetItem).toHaveBeenCalledWith(STORAGE_KEYS.HISTORY, expect.any(String));
  });
});
