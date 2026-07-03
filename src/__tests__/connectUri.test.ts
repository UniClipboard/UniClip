import {
  parseConnectUri,
  CONNECT_URI_ERROR_MESSAGES,
  type ConnectUriError,
} from '@/utils/connectUri';
import { parseConnectUri as rustParseConnectUri } from 'uc-core';

const mockRustParse = rustParseConnectUri as jest.MockedFunction<typeof rustParseConnectUri>;

beforeEach(() => {
  mockRustParse.mockReset();
});

describe('parseConnectUri — positive', () => {
  it('delegates to Rust and maps ConnectPayload → ConnectUriResult', () => {
    mockRustParse.mockReturnValue({
      v: 1,
      url: 'http://192.168.1.5:42720',
      urls: ['http://192.168.1.5:42720'],
      user: 'mobile_aabbccdd',
      pwd: 'AbCdEfGhIjKlMnOpQrSt',
      other: { label: 'Test', did: 'did_0123abcd', proto: 'syncclipboard' },
    });
    const r = parseConnectUri('uniclipboard://connect?v=1&svc=mobile-sync&p=...');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({
        url: 'http://192.168.1.5:42720',
        urls: ['http://192.168.1.5:42720'],
        user: 'mobile_aabbccdd',
        pwd: 'AbCdEfGhIjKlMnOpQrSt',
        label: 'Test',
      });
    }
    expect(mockRustParse).toHaveBeenCalledWith('uniclipboard://connect?v=1&svc=mobile-sync&p=...');
  });

  it('label is omitted when other has no label key', () => {
    mockRustParse.mockReturnValue({
      v: 1,
      url: 'http://a.b',
      urls: [],
      user: 'u',
      pwd: 'p',
      other: {},
    });
    const r = parseConnectUri('uniclipboard://connect?...');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.label).toBeUndefined();
    }
  });

  it('trims whitespace before passing to Rust', () => {
    mockRustParse.mockReturnValue({
      v: 1,
      url: 'http://a.b',
      urls: [],
      user: 'u',
      pwd: 'p',
      other: {},
    });
    parseConnectUri('  \nuniclipboard://connect?...\t ');
    expect(mockRustParse).toHaveBeenCalledWith('uniclipboard://connect?...');
  });
});

describe('parseConnectUri — negative (Rust error mapping)', () => {
  const cases: Array<{ rustError: string; expected: ConnectUriError }> = [
    { rustError: 'ConnectUriError.InvalidScheme', expected: 'INVALID_SCHEME' },
    { rustError: 'ConnectUriError.UnsupportedVersion', expected: 'UNSUPPORTED_VERSION' },
    { rustError: 'ConnectUriError.UnsupportedService', expected: 'UNSUPPORTED_SERVICE' },
    {
      rustError: 'ConnectUriError.PayloadDecodeFailed: base64url: invalid',
      expected: 'PAYLOAD_DECODE_FAILED',
    },
    { rustError: 'ConnectUriError.MissingField: pwd', expected: 'MISSING_FIELD' },
    { rustError: 'ConnectUriError.InvalidUrl', expected: 'INVALID_URL' },
  ];

  test.each(cases)('Rust throws "$rustError" → $expected', ({ rustError, expected }) => {
    mockRustParse.mockImplementation(() => {
      throw new Error(rustError);
    });
    const r = parseConnectUri('uniclipboard://connect?...');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(expected);
  });
});

describe('parseConnectUri — edge cases', () => {
  it('empty string → INVALID_SCHEME (no Rust call)', () => {
    const r = parseConnectUri('');
    expect(r).toEqual({ ok: false, error: 'INVALID_SCHEME' });
    expect(mockRustParse).not.toHaveBeenCalled();
  });

  it('unknown Rust error maps to PAYLOAD_DECODE_FAILED', () => {
    mockRustParse.mockImplementation(() => {
      throw new Error('SomeUnknownError');
    });
    const r = parseConnectUri('uniclipboard://anything');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('PAYLOAD_DECODE_FAILED');
  });
});

describe('CONNECT_URI_ERROR_MESSAGES', () => {
  it('every error code has a non-empty message', () => {
    const codes: ConnectUriError[] = [
      'INVALID_SCHEME',
      'UNSUPPORTED_VERSION',
      'UNSUPPORTED_SERVICE',
      'PAYLOAD_DECODE_FAILED',
      'MISSING_FIELD',
      'INVALID_URL',
    ];
    for (const c of codes) {
      expect(typeof CONNECT_URI_ERROR_MESSAGES[c]).toBe('string');
      expect(CONNECT_URI_ERROR_MESSAGES[c].length).toBeGreaterThan(0);
    }
  });
});
