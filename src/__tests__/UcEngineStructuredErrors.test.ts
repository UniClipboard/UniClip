import { describe, expect, it, jest } from '@jest/globals';

jest.mock('expo-modules-core', () => {
  const native = {
    createSpace: jest.fn(),
    issueInvitation: jest.fn(),
    joinSpace: jest.fn(),
    getAnalyticsState: jest.fn(async () => ({})),
  };
  return { requireNativeModule: () => native, __native: native };
});
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import { createSpace, issueInvitation, joinSpace, UcEngineError } from 'uc-engine';
import { unifiedSpaceUserErrorCode } from '../features/space';

const mockNative = jest.requireMock('expo-modules-core').__native as Record<
  'createSpace' | 'issueInvitation' | 'joinSpace',
  jest.Mock<(...args: unknown[]) => Promise<unknown>>
>;

const failure = { code: 1233, category: 'authentication', retryable: false };

describe('structured Engine failures', () => {
  it.each([
    ['createSpace', () => createSpace('Phone', 'secret'), mockNative.createSpace],
    ['issueInvitation', () => issueInvitation(), mockNative.issueInvitation],
    ['joinSpace', () => joinSpace('072-834', 'Phone', 'secret'), mockNative.joinSpace],
  ] as const)('%s throws UcEngineError with code, category and retryable', async (_name, call, native) => {
    native.mockResolvedValueOnce({ ok: false, failure });

    const error = await call().catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(UcEngineError);
    expect(error).toMatchObject(failure);
  });

  it('returns the value of a successful call', async () => {
    mockNative.issueInvitation.mockResolvedValueOnce({ ok: true, value: { invitationCode: '072-834' } });

    await expect(issueInvitation()).resolves.toEqual({ invitationCode: '072-834' });
  });

  it('maps the user-facing code from the structured failure and ignores digits in text', () => {
    expect(unifiedSpaceUserErrorCode(new UcEngineError({ ...failure, code: 1236 }))).toBe('sponsorUnreachable');
    expect(unifiedSpaceUserErrorCode(new Error('Engine error 1233 at /Users/1234/x'))).toBeNull();
    expect(unifiedSpaceUserErrorCode(Object.assign(new Error('failed 1234'), { code: 'ERR_1235' }))).toBeNull();
  });
});
