const mockError = jest.fn();
const mockRemoteLog = jest.fn();
jest.mock('../support/observability/internal/postHogAnalytics', () => ({
  capturePostHogLog: (...args: unknown[]) => mockRemoteLog(...args),
}));
const mockLogInstance = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: mockError,
  patchConsole: jest.fn(),
  setSeverity: jest.fn(),
};

jest.mock('react-native-logs', () => ({
  logger: { createLogger: () => mockLogInstance },
  consoleTransport: jest.fn(),
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios', Version: '18.0' },
}));

jest.mock('app-group-store', () => ({
  getEngineLogFileUris: () => [],
}));

jest.mock('expo-file-system', () => {
  class MockDirectory {
    exists = true;
    create = jest.fn();
    list = jest.fn(() => []);
    constructor(..._parts: unknown[]) {}
  }
  class MockFile {
    exists = false;
    constructor(..._parts: unknown[]) {}
  }
  return {
    File: MockFile,
    Directory: MockDirectory,
    Paths: { document: 'file://documents', cache: 'file://cache' },
  };
});

import { createLogger, setLogLevel } from '../support/observability';

describe('Logger structured write redaction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sanitizes nested logger arguments before serialization', () => {
    const log = createLogger('Sync');
    log.error('sync failed', {
      status: 401,
      config: {
        url: 'https://example.test/sync',
        headers: { Authorization: 'Bearer structured-token' },
        auth: { username: 'alice', password: 'structured-password' },
      },
    });

    const serialized = JSON.stringify(mockError.mock.calls[0][0]);
    expect(serialized).toContain('[Sync] sync failed');
    expect(serialized).toContain('sync failed');
    expect(serialized).toContain('status');
    expect(serialized).not.toContain('structured-token');
    expect(serialized).not.toContain('structured-password');
    expect(serialized).not.toContain('alice');
  });

  it('also offers scoped logs to the remote filter without replacing local logging', () => {
    createLogger('UnifiedSpaceService').error('Join space failed', { errorCode: 1237 });
    expect(mockError).toHaveBeenCalled();
    expect(mockRemoteLog).toHaveBeenCalledWith('error', 'UnifiedSpaceService', [
      'Join space failed', { errorCode: 1237 },
    ]);
  });

  it('honors the selected log level for remote delivery', () => {
    setLogLevel('error');
    createLogger('P2pSyncAdapter').info('P2P space state', { deviceCount: 2 });
    expect(mockRemoteLog).not.toHaveBeenCalled();
    setLogLevel('info');
  });
});
