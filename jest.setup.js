jest.mock('expo-crypto', () => ({
  digestStringAsync: jest.fn(),
  CryptoDigestAlgorithm: {
    SHA256: 'SHA-256',
  },
  CryptoEncoding: {
    HEX: 'hex',
  },
}));

jest.mock('expo-clipboard', () => ({
  getStringAsync: jest.fn(),
  setStringAsync: jest.fn(),
  getImageAsync: jest.fn(),
  setImageAsync: jest.fn(),
}));

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.0.0',
}));

// expo-localization 会拉入 expo-modules-core(在 node 测试环境下缺 EventEmitter 而抛错)。
// 直接 mock 掉,返回一个 zh 设备语言,使 i18n 初始化为 zh-CN(与测试对基准中文文案的断言一致)。
jest.mock('expo-localization', () => ({
  getLocales: () => [
    {
      languageCode: 'zh',
      languageTag: 'zh-CN',
      regionCode: 'CN',
      textDirection: 'ltr',
      decimalSeparator: '.',
      digitGroupingSeparator: ',',
      measurementSystem: 'metric',
      currencyCode: 'CNY',
      currencySymbol: '¥',
    },
  ],
  getCalendars: () => [
    { calendar: 'gregory', timeZone: 'Asia/Shanghai', uses24hourClock: true, firstWeekday: 1 },
  ],
}));

jest.mock('react-native-logs', () => ({
  consoleTransport: jest.fn(),
  logger: {
    createLogger: jest.fn(() => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      patchConsole: jest.fn(),
      setSeverity: jest.fn(),
    })),
  },
}));

jest.mock('expo-file-system', () => {
  class MockDirectory {
    constructor(...parts) {
      this.parts = parts;
      this.name = String(parts[parts.length - 1] ?? '');
      this.uri = parts
        .map((part) => (typeof part === 'string' ? part : part?.uri ?? ''))
        .join('/')
        .replace(/\/+/g, '/')
        .replace('file:/', 'file://');
      this.exists = true;
      this.isDirectory = true;
    }

    create = jest.fn();
    delete = jest.fn();
    list = jest.fn(() => []);
  }

  class MockFile {
    static moveMock = jest.fn();
    static existsMock = jest.fn(() => true);

    constructor(...parts) {
      this.parts = parts;
      this.name = String(parts[parts.length - 1] ?? '');
      this.uri = parts
        .map((part) => (typeof part === 'string' ? part : part?.uri ?? ''))
        .join('/')
        .replace(/\/+/g, '/')
        .replace('file:/', 'file://');
      this.exists = MockFile.existsMock(this.uri);
      this.isDirectory = false;
    }

    info = jest.fn().mockReturnValue({ exists: true, size: 1000 });
    open = jest.fn().mockReturnValue({
      readBytes: jest.fn().mockReturnValue(new Uint8Array(10)),
      close: jest.fn(),
    });
    textSync = jest.fn().mockReturnValue('');
    write = jest.fn();
    delete = jest.fn();
    move = (...args) => MockFile.moveMock(...args);
    arrayBuffer = jest.fn().mockResolvedValue(new ArrayBuffer(0));

    static downloadFileAsync = jest.fn().mockResolvedValue(undefined);
  }

  return {
    File: MockFile,
    Directory: MockDirectory,
    Paths: {
      document: 'file://documents',
      cache: 'file://cache',
    },
    DocumentDirectory: 'file://documents/',
    CacheDirectory: 'file://cache/',
  };
});

jest.mock('expo-file-system/legacy', () => ({
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: jest.fn(),
    createFileAsync: jest.fn(),
    writeAsStringAsync: jest.fn(),
  },
  EncodingType: {
    Base64: 'base64',
    UTF8: 'utf8',
  },
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  copyAsync: jest.fn(),
  deleteAsync: jest.fn(),
  getInfoAsync: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
    getAllKeys: jest.fn().mockResolvedValue([]),
    multiGet: jest.fn().mockResolvedValue([]),
    multiSet: jest.fn().mockResolvedValue(undefined),
    multiRemove: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('android-util', () => ({
  isNativeHashModuleAvailable: jest.fn().mockReturnValue(false),
  nativeCalculateFileHash: jest.fn(),
  nativeSaveClipboardFileToFile: jest.fn().mockResolvedValue(null),
  nativeGetClipboardFileSourceId: jest.fn().mockReturnValue(null),
  isTailscaleActive: jest.fn().mockReturnValue(false),
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn(),
  },
}));

jest.mock('app-group-store', () => ({
  saveSettings: jest.fn().mockResolvedValue(undefined),
  getSettings: jest.fn().mockResolvedValue({}),
  clearLegacyLanConfiguration: jest.fn().mockResolvedValue(undefined),
  getContainerUrl: jest.fn().mockResolvedValue(null),
  getLegacyHistory: jest.fn().mockResolvedValue(null),
  getPayloadFileUri: jest.fn().mockResolvedValue(null),
  writePayload: jest.fn().mockResolvedValue(null),
  deletePayload: jest.fn().mockResolvedValue(undefined),
  clearPayloads: jest.fn().mockResolvedValue(undefined),
  getPayloadStats: jest.fn().mockResolvedValue({ count: 0, totalSize: 0 }),
  migrateLegacyContainer: jest.fn().mockResolvedValue({ migrated: false, keys: 0 }),
  getPasteboardChangeCount: jest.fn(() => null),
}));

global.setImmediate = jest.useRealTimers;

// 每个测试后重置 SQLite 单例,保证测试间使用全新的 :memory: 数据库(隔离)
afterEach(async () => {
  try {
    const { _closeDatabaseForTest } = require('@/platform/database/sqliteDatabase');
    await _closeDatabaseForTest();
  } catch {
    // db 模块未加载或未打开,忽略
  }
});
