import { LOG_REDACTED, redactLogText, redactLogValue } from '../services/logRedaction';

describe('log redaction', () => {
  it('redacts credentials in nested network errors without mutating the source', () => {
    const networkError = new Error('Request failed with status code 401');
    Object.assign(networkError, {
      status: 401,
      originalError: {
        config: {
          method: 'post',
          url: 'https://alice:url-password@example.test/sync?access_token=query-token&mode=pull',
          headers: {
            Authorization: 'Basic YWxpY2U6cGFzc3dvcmQ=',
            Cookie: 'session=session-cookie',
          },
          auth: {
            username: 'alice',
            password: 'account-password',
          },
        },
        response: { status: 401, statusText: 'Unauthorized' },
      },
      refreshToken: 'refresh-token',
    });

    const redacted = redactLogValue(networkError) as Record<string, unknown>;
    const serialized = JSON.stringify(redacted);

    for (const secret of [
      'YWxpY2U6cGFzc3dvcmQ=',
      'session-cookie',
      'account-password',
      'refresh-token',
      'query-token',
      'url-password',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain('example.test/sync');
    expect(serialized).toContain('mode=pull');
    expect(serialized).toContain('Request failed with status code 401');
    expect(serialized).toContain('Unauthorized');
    expect((networkError as Error & { refreshToken: string }).refreshToken).toBe('refresh-token');
  });

  it('redacts sensitive fields, auth schemes, URL credentials, and query values in old text', () => {
    const text = [
      '2026-07-18 16:52:23 ERROR [SyncClipboardClient]: Request failed with status 401',
      'Authorization: Bearer auth-token',
      'Proxy-Authorization="Basic cHJveHk6cGFzcw=="',
      'username=account-name password: account-password',
      'Cookie: session=session-cookie',
      'https://url-user:url-password@example.test/sync?token=query-token&mode=pull',
    ].join('\n');

    const redacted = redactLogText(text);

    for (const secret of [
      'auth-token',
      'cHJveHk6cGFzcw==',
      'account-name',
      'account-password',
      'session-cookie',
      'url-user',
      'url-password',
      'query-token',
    ]) {
      expect(redacted).not.toContain(secret);
    }
    expect(redacted).toContain(LOG_REDACTED);
    expect(redacted).toContain('2026-07-18 16:52:23');
    expect(redacted).toContain('status 401');
    expect(redacted).toContain('example.test/sync');
    expect(redacted).toContain('mode=pull');
  });

  it('handles circular structures and redacts error messages containing bearer credentials', () => {
    const value: { error: Error; self?: unknown } = {
      error: new Error('Upload rejected: Bearer nested-token'),
    };
    value.self = value;

    const redacted = redactLogValue(value) as {
      error: { name: string; message: string };
      self: string;
    };

    expect(redacted.error.name).toBe('Error');
    expect(redacted.error.message).toBe(`Upload rejected: Bearer ${LOG_REDACTED}`);
    expect(redacted.self).toBe('[Circular]');
  });
});
