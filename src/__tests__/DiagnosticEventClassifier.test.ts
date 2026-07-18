/// <reference types="jest" />

import {
  classifyDiagnosticEvent,
  classifyDiagnosticReason,
  type DiagnosticReason,
} from '../services/DiagnosticEventClassifier';

describe('DiagnosticEventClassifier', () => {
  it.each<[string, DiagnosticReason]>([
    ['HTTP 401 unauthorized', 'authentication'],
    ['operation was aborted', 'cancelled'],
    ['pasteboard permission denied', 'permission_denied'],
    ['TLS certificate trust evaluation failed', 'tls_or_certificate'],
    ['request timed out', 'timeout'],
    ['HTTP 404 not found', 'not_found'],
    ['invalid JSON response could not decode', 'invalid_response'],
    ['SQLite database directory unavailable', 'storage'],
    ['network unreachable: connection refused', 'network_unreachable'],
  ])('maps %s to the fixed reason %s', (message, expected) => {
    expect(classifyDiagnosticReason(message)).toBe(expected);
  });

  it('classifies a known operation without returning its sensitive detail', () => {
    const message =
      '[SyncEngine] op error: TLS certificate failure at https://alice:secret@example.test';

    const event = classifyDiagnosticEvent(message, 'error');

    expect(event).toEqual({
      eventCode: 'sync.operation_failed',
      reason: 'tls_or_certificate',
    });
    expect(JSON.stringify(event)).not.toContain('alice');
    expect(JSON.stringify(event)).not.toContain('secret');
    expect(JSON.stringify(event)).not.toContain('example.test');
  });

  it('does not mislabel a missing active-server configuration as a remote not-found error', () => {
    expect(classifyDiagnosticEvent('[SyncEngineStore] Active server: none', 'info')).toEqual({
      eventCode: 'sync.active_server_missing',
      reason: null,
    });
  });

  it('keeps a categorized unknown issue but drops arbitrary unknown text', () => {
    expect(classifyDiagnosticEvent('request timed out for private payload', 'error')).toEqual({
      eventCode: 'runtime.unclassified_issue',
      reason: 'timeout',
    });
    expect(classifyDiagnosticEvent('arbitrary private clipboard words', 'error')).toBeNull();
  });
});
