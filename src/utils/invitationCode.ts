export function normalizeInvitationCodeInput(value: string): string {
  return value.normalize('NFKC').replace(/[-\s]/g, '');
}

export function formatInvitationCode(value: string): string {
  const body = normalizeInvitationCodeInput(value);
  return body.length > 3 ? `${body.slice(0, 3)}-${body.slice(3)}` : body;
}

export function isInvitationCodeComplete(value: string): boolean {
  return /^[0-9]{6}$/.test(normalizeInvitationCodeInput(value));
}

export function invitationCodeForSubmission(value: string): string | null {
  return isInvitationCodeComplete(value) ? formatInvitationCode(value) : null;
}

export function invitationCodeInputValue(value: string): string {
  return normalizeInvitationCodeInput(value);
}
