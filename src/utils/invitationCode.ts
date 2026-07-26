const INVITATION_BODY_LENGTH = 8;
const ALLOWED_CHARACTER = /^[0-9A-HJKMNP-TV-Z]$/;

export function normalizeInvitationCodeInput(value: string): string {
  let normalized = '';

  for (const character of value.normalize('NFKC').toUpperCase()) {
    if (character === '-' || /\s/.test(character)) continue;

    const mapped =
      character === 'O' ? '0' : character === 'I' || character === 'L' ? '1' : character;
    if (ALLOWED_CHARACTER.test(mapped)) normalized += mapped;
  }

  return normalized;
}

export function formatInvitationCode(value: string): string {
  const body = normalizeInvitationCodeInput(value);
  return body.length > 4 ? `${body.slice(0, 4)}-${body.slice(4)}` : body;
}

export function isInvitationCodeComplete(value: string): boolean {
  return normalizeInvitationCodeInput(value).length === INVITATION_BODY_LENGTH;
}

export function invitationCodeForSubmission(value: string): string | null {
  return isInvitationCodeComplete(value) ? formatInvitationCode(value) : null;
}

export function invitationCodeInputValue(value: string): string {
  return normalizeInvitationCodeInput(value).slice(0, INVITATION_BODY_LENGTH);
}
