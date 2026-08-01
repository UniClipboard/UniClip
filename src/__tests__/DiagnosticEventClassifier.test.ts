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
      '[UnifiedEngineService] Failed to start the P2P engine: TLS certificate failure at https://alice:secret@example.test';

    const event = classifyDiagnosticEvent(message, 'error');

    expect(event).toEqual({
      eventCode: 'p2p.engine_start_failed',
      reason: 'tls_or_certificate',
    });
    expect(JSON.stringify(event)).not.toContain('alice');
    expect(JSON.stringify(event)).not.toContain('secret');
    expect(JSON.stringify(event)).not.toContain('example.test');
  });

  it('classifies P2P peer recovery without retaining its detail', () => {
    expect(
      classifyDiagnosticEvent(
        '[UnifiedEngineService] Peer recovery refresh failed: connection refused',
        'warn'
      )
    ).toEqual({ eventCode: 'p2p.peer_recovery_failed', reason: 'network_unreachable' });
  });

  it('keeps a categorized unknown issue but drops arbitrary unknown text', () => {
    expect(classifyDiagnosticEvent('request timed out for private payload', 'error')).toEqual({
      eventCode: 'runtime.unclassified_issue',
      reason: 'timeout',
    });
    expect(classifyDiagnosticEvent('arbitrary private clipboard words', 'error')).toBeNull();
  });
});
