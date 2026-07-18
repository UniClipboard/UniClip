import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256 } from 'js-sha256';
import { createAPIClient } from '../services/apiClientFactory';
import { STORAGE_KEYS } from '../types/storage';
import SmsUploadTask, { extractVerificationCode } from '../tasks/SmsUploadTask';
import * as ClipboardProxy from '../utils/clipboardProxy';
import {
  extractVerificationCode as nativeExtractVerificationCode,
  startSmsUploadCountdown,
  updateSmsUploadNotification,
} from 'sms-forwarder';

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

jest.mock('sms-forwarder', () => ({
  extractVerificationCode: jest.fn(),
  startSmsUploadCountdown: jest.fn(),
  updateSmsUploadNotification: jest.fn(),
}));

jest.mock('@/services/apiClientFactory', () => ({
  createAPIClient: jest.fn(),
}));

jest.mock('@/services/WebDAVClient', () => ({
  WebDAVClient: jest.fn(),
}));

jest.mock('@/services/S3Client', () => ({
  S3Client: jest.fn(),
}));

jest.mock('@/utils/clipboardProxy', () => ({
  setStringAsync: jest.fn(),
}));

jest.mock('@/services/Logger', () => ({
  log: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('@/i18n', () => ({
  __esModule: true,
  default: {
    t: jest.fn((key: string) => key),
  },
}));

const mockedAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const mockedCreateAPIClient = createAPIClient as jest.MockedFunction<typeof createAPIClient>;
const mockedExtract = nativeExtractVerificationCode as jest.MockedFunction<
  typeof nativeExtractVerificationCode
>;
const mockedSetString = ClipboardProxy.setStringAsync as jest.MockedFunction<
  typeof ClipboardProxy.setStringAsync
>;
const mockedStartCountdown = startSmsUploadCountdown as jest.MockedFunction<
  typeof startSmsUploadCountdown
>;
const mockedUpdateNotification = updateSmsUploadNotification as jest.MockedFunction<
  typeof updateSmsUploadNotification
>;

const enabledConfig = {
  enableSmsForwarding: true,
  activeServerIndex: 0,
  servers: [
    {
      type: 'syncclipboard',
      url: 'https://clip.example.com',
    },
  ],
};

describe('SmsUploadTask', () => {
  const putClipboard = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(enabledConfig));
    mockedExtract.mockReturnValue('482915');
    mockedSetString.mockResolvedValue(true);
    mockedCreateAPIClient.mockReturnValue({ putClipboard } as never);
  });

  it('delegates verification-code parsing to the native extractor', () => {
    const body = '您的验证码是 482915，请勿泄露。';

    expect(extractVerificationCode(body)).toBe('482915');
    expect(mockedExtract).toHaveBeenCalledWith(body);
  });

  it('copies an extracted code to the clipboard and pushes it to the active server', async () => {
    await SmsUploadTask({
      from: '10690000',
      body: '【UniClipboard】您的验证码是 482915，请勿泄露。',
    });

    expect(mockedSetString).toHaveBeenCalledWith('482915');
    expect(mockedAsyncStorage.getItem).toHaveBeenCalledWith(STORAGE_KEYS.CONFIG);
    expect(mockedCreateAPIClient).toHaveBeenCalledWith(enabledConfig.servers[0]);
    expect(putClipboard).toHaveBeenCalledWith({
      type: 'Text',
      text: '482915',
      hash: sha256('482915').toUpperCase(),
      hasData: false,
    });
    expect(mockedUpdateNotification).toHaveBeenCalledWith('share:sms.uploading');
    expect(mockedStartCountdown).toHaveBeenCalledWith('482915');
    expect(mockedSetString.mock.invocationCallOrder[0]).toBeLessThan(
      putClipboard.mock.invocationCallOrder[0]
    );
  });

  it('still pushes when a headless clipboard write fails', async () => {
    mockedSetString.mockRejectedValueOnce(new Error('clipboard unavailable'));

    await SmsUploadTask({ from: '10690000', body: 'Verification code is 482915' });

    expect(putClipboard).toHaveBeenCalledTimes(1);
    expect(mockedStartCountdown).toHaveBeenCalledWith('482915');
  });

  it('does nothing when the SMS does not contain a verification code', async () => {
    mockedExtract.mockReturnValueOnce(null);

    await SmsUploadTask({ from: '10690000', body: 'Your parcel has shipped.' });

    expect(mockedSetString).not.toHaveBeenCalled();
    expect(mockedAsyncStorage.getItem).not.toHaveBeenCalled();
    expect(putClipboard).not.toHaveBeenCalled();
  });
});
