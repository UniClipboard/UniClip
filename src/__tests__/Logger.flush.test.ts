const mockWrites: string[] = [];
const mockCapturePostHogLog = jest.fn();

jest.mock('react-native-logs', () => ({
  consoleTransport: jest.fn(),
  logger: {
    createLogger: (config: { asyncFunc: (callback: () => void) => void; transport: Array<(props: unknown) => void> }) => {
      const write = (message: string) => config.asyncFunc(() => {
        config.transport.forEach((transport) => transport({msg: message, rawMsg: message, level: {severity: 3, text: 'error'}}));
      });
      return {debug: write, info: write, warn: write, error: write, patchConsole: jest.fn(), setSeverity: jest.fn()};
    },
  },
}));

jest.mock('expo-file-system', () => ({
  Directory: class { exists = true; list() { return []; } create() {} },
  File: class { write(value: string) { mockWrites.push(value); } },
  Paths: {document: 'file://documents', cache: 'file://cache'},
}));

jest.mock('../support/observability/internal/postHogAnalytics', () => ({
  capturePostHogLog: (...args: unknown[]) => mockCapturePostHogLog(...args),
}));

import { createLogger, flushAppLogs, getAppLogCaptureStatus, initLogger } from '../support/observability/internal/logger';

it('flushes queued app records once without changing PostHog capture', async () => {
  jest.useFakeTimers();
  try {
    initLogger({level: 'error', enableConsole: false});
    createLogger('LogFlushTest').error('connection failed');
    expect(mockWrites).toHaveLength(0);
    expect(mockCapturePostHogLog).toHaveBeenCalledTimes(1);
    expect(await flushAppLogs()).toBe(true);
    expect(mockWrites).toHaveLength(1);
    expect(mockWrites[0]).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z ERROR/);
    jest.runOnlyPendingTimers();
    expect(mockWrites).toHaveLength(1);
    expect(getAppLogCaptureStatus()).toMatchObject({effectiveLevel: 'error', enabled: true, pendingRecords: 0});
  } finally { jest.useRealTimers(); }
});
