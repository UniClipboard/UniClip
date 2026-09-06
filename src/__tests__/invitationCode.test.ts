import {
  formatInvitationCode,
  invitationCodeForSubmission,
  invitationCodeInputValue,
  isInvitationCodeComplete,
} from '@/utils/invitationCode';

describe('six-digit invitation codes', () => {
  it.each(['001234', '001-234', ' 001 234 ', '００１２３４'])(
    'preserves leading zeros and normalizes %s',
    (input) => {
      expect(invitationCodeInputValue(input)).toBe('001234');
      expect(invitationCodeForSubmission(input)).toBe('001-234');
    }
  );

  it.each(['', '12345', '1234567', '1234-5678', 'ABC-DEF', 'O01-234', '123!456'])(
    'rejects invalid code %s without turning it into a different code',
    (input) => {
      expect(isInvitationCodeComplete(input)).toBe(false);
      expect(invitationCodeForSubmission(input)).toBeNull();
      expect(isInvitationCodeComplete(invitationCodeInputValue(input))).toBe(false);
    }
  );

  it('formats two groups of three digits', () => {
    expect(formatInvitationCode('123456')).toBe('123-456');
    expect(formatInvitationCode('123')).toBe('123');
  });
});
