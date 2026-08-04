export const LOG_REDACTED = '[REDACTED]';

const LOG_CIRCULAR = '[Circular]';
const LOG_MAX_DEPTH = '[MaxDepth]';
const MAX_REDACTION_DEPTH = 24;

const SENSITIVE_KEY_NAMES = new Set([
  'authorization',
  'proxyauthorization',
  'password',
  'passwd',
  'passphrase',
  'pwd',
  'username',
  'user',
  'userid',
  'account',
  'accountid',
  'accountname',
  'login',
  'email',
  'token',
  'secret',
  'clientsecret',
  'apikey',
  'xapikey',
  'cookie',
  'setcookie',
  'credential',
  'credentials',
]);

const SENSITIVE_KEY_PARTS = [
  'authorization',
  'password',
  'passwd',
  'passphrase',
  'username',
  'userid',
  'accountid',
  'accountname',
  'token',
  'secret',
  'apikey',
  'cookie',
  'credential',
];

const SENSITIVE_TEXT_KEY =
  '(?:proxy[-_ ]?authorization|authorization|password|passwd|passphrase|pwd|user[-_ ]?name|user[-_ ]?id|account(?:[-_ ]?(?:id|name))?|login|email|(?:access|refresh|id|auth|session)?[-_ ]?token|(?:client[-_ ]?)?secret|(?:x[-_ ]?)?api[-_ ]?key|set[-_ ]?cookie|cookie|credentials?)';

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    SENSITIVE_KEY_NAMES.has(normalized) ||
    SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part))
  );
}

/** Redacts credentials embedded in already-formatted or historical log text. */
export function redactLogText(text: string): string {
  let redacted = text;

  redacted = redacted.replace(
    /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/@]+(?::[^\s/@]*)?@)/gi,
    (_match, scheme: string) => `${scheme}${LOG_REDACTED}@`
  );

  const sensitiveQueryPattern = new RegExp(`([?&]${SENSITIVE_TEXT_KEY}=)([^&#\\s]*)`, 'gi');
  redacted = redacted.replace(
    sensitiveQueryPattern,
    (_match, prefix: string) => `${prefix}${LOG_REDACTED}`
  );

  redacted = redacted.replace(
    /\b(Bearer|Basic)\s+([A-Za-z0-9._~+/=-]+)/gi,
    (_match, scheme: string) => `${scheme} ${LOG_REDACTED}`
  );

  const sensitiveFieldPattern = new RegExp(
    `((?:["']?${SENSITIVE_TEXT_KEY}["']?)\\s*[:=]\\s*)(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^\\s,;}\\]]+)`,
    'gi'
  );
  redacted = redacted.replace(
    sensitiveFieldPattern,
    (_match, prefix: string) => `${prefix}${LOG_REDACTED}`
  );

  return redacted;
}

function sanitizeValue(value: unknown, ancestors: WeakSet<object>, depth: number): unknown {
  if (typeof value === 'string') return redactLogText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_REDACTION_DEPTH) return LOG_MAX_DEPTH;
  if (ancestors.has(value)) return LOG_CIRCULAR;

  ancestors.add(value);
  try {
    if (value instanceof Date) return new Date(value.getTime());

    if (value instanceof Error) {
      const sanitizedError: Record<string, unknown> = {
        name: redactLogText(value.name),
        message: redactLogText(value.message),
      };
      if (value.stack) sanitizedError.stack = redactLogText(value.stack);

      for (const key of Object.keys(value)) {
        if (key === 'name' || key === 'message' || key === 'stack') continue;
        sanitizedError[key] = isSensitiveKey(key)
          ? LOG_REDACTED
          : sanitizeValue((value as unknown as Record<string, unknown>)[key], ancestors, depth + 1);
      }
      return sanitizedError;
    }

    if (Array.isArray(value)) {
      return value.map((entry) => sanitizeValue(entry, ancestors, depth + 1));
    }

    const sanitized: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      sanitized[key] = isSensitiveKey(key)
        ? LOG_REDACTED
        : sanitizeValue((value as Record<string, unknown>)[key], ancestors, depth + 1);
    }
    return sanitized;
  } finally {
    ancestors.delete(value);
  }
}

/** Returns a sanitized copy and never mutates the value supplied by the caller. */
export function redactLogValue(value: unknown): unknown {
  return sanitizeValue(value, new WeakSet<object>(), 0);
}
