/// <reference types="jest" />

const mockShareAsync = jest.fn<Promise<void>, [string, unknown]>(async () => undefined);

jest.mock('react-native', () => ({
  NativeModules: {},
  Platform: { OS: 'ios' },
}));

jest.mock('expo-media-library', () => ({
  Asset: { create: jest.fn() },
  requestPermissionsAsync: jest.fn(),
}));

jest.mock('expo-sharing', () => ({
  shareAsync: (uri: string, options: unknown) => mockShareAsync(uri, options),
}));

import { shareFile } from '../utils/fileActions.shared';

describe('shareFile', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shares JSON diagnostics with the correct MIME type and iOS UTI', async () => {
    await shareFile('file://cache/uniclip_diagnostics.json', 'uniclip_diagnostics.json');

    expect(mockShareAsync).toHaveBeenCalledWith('file://cache/uniclip_diagnostics.json', {
      mimeType: 'application/json',
      dialogTitle: 'uniclip_diagnostics.json',
      UTI: 'public.json',
    });
  });

  it('keeps ZIP sharing interoperable on iOS', async () => {
    await shareFile('file://cache/logs.zip', 'logs.zip');

    expect(mockShareAsync).toHaveBeenCalledWith('file://cache/logs.zip', {
      mimeType: 'application/zip',
      dialogTitle: 'logs.zip',
      UTI: 'public.zip-archive',
    });
  });
});
