export type DiagnosticReason =
  | 'authentication'
  | 'cancelled'
  | 'invalid_response'
  | 'network_unreachable'
  | 'not_found'
  | 'permission_denied'
  | 'storage'
  | 'timeout'
  | 'tls_or_certificate'
  | 'unknown';

export interface ClassifiedDiagnosticEvent {
  eventCode: string;
  reason: DiagnosticReason | null;
}

interface EventRule {
  pattern: RegExp;
  eventCode: string;
  fallbackReason?: DiagnosticReason;
}

const EVENT_RULES: EventRule[] = [
  // P2P engine lifecycle and peer recovery.
  {
    pattern: /\[UnifiedEngineService\] Failed to start the P2P engine:/,
    eventCode: 'p2p.engine_start_failed',
  },
  {
    pattern: /\[UnifiedEngineService\] Failed to stop the P2P engine:/,
    eventCode: 'p2p.engine_stop_failed',
  },
  {
    pattern: /\[UnifiedEngineService\] Failed to read a P2P engine event:/,
    eventCode: 'p2p.event_read_failed',
  },
  {
    pattern: /\[UnifiedEngineService\] A P2P event subscriber failed:/,
    eventCode: 'p2p.subscriber_failed',
  },
  {
    pattern: /\[UnifiedEngineService\] The P2P engine reported a fatal failure:/,
    eventCode: 'p2p.fatal_failure',
  },
  {
    pattern: /\[UnifiedEngineService\] The P2P engine failed to /,
    eventCode: 'p2p.lifecycle_failed',
  },
  {
    pattern: /\[UnifiedEngineService\] Peer recovery refresh failed:/,
    eventCode: 'p2p.peer_recovery_failed',
    fallbackReason: 'network_unreachable',
  },
  {
    pattern: /\[AppRuntime\] Failed to recover P2P peer connections:/,
    eventCode: 'p2p.background_peer_recovery_failed',
    fallbackReason: 'network_unreachable',
  },
  {
    pattern: /\[P2pClipboardObserver\] Clipboard observation failed; kept local:/,
    eventCode: 'p2p.clipboard_observation_failed',
  },

  // Clipboard observation and writes.
  {
    pattern: /\[ClipboardManager\] Failed to get (?:image|clipboard content):/,
    eventCode: 'clipboard.read_failed',
  },
  {
    pattern: /\[ClipboardManager\] Failed to save text to file:/,
    eventCode: 'clipboard.text_file_save_failed',
    fallbackReason: 'storage',
  },
  {
    pattern: /\[ClipboardManager\] Failed to set (?:text|image) content:/,
    eventCode: 'clipboard.write_failed',
  },
  {
    pattern: /\[ClipboardManager\] Failed to clear clipboard:/,
    eventCode: 'clipboard.clear_failed',
  },
  {
    pattern: /\[ClipboardManager\] Failed to check clipboard change:/,
    eventCode: 'clipboard.change_check_failed',
  },
  {
    pattern: /\[ClipboardManager\] Failed to pick image:/,
    eventCode: 'clipboard.image_pick_failed',
  },
  {
    pattern: /\[ClipboardManager\] Failed to take photo:/,
    eventCode: 'clipboard.camera_capture_failed',
  },
  {
    pattern: /\[ClipboardMonitor\] Started monitoring \(event-driven\)/,
    eventCode: 'clipboard.monitor_event_started',
  },
  {
    pattern: /\[ClipboardMonitor\] Started monitoring \(polling\)/,
    eventCode: 'clipboard.monitor_polling_started',
  },
  { pattern: /\[ClipboardMonitor\] Stopped monitoring/, eventCode: 'clipboard.monitor_stopped' },
  {
    pattern: /\[ClipboardMonitor\] Pasteboard read denied by user/,
    eventCode: 'clipboard.read_denied',
    fallbackReason: 'permission_denied',
  },
  {
    pattern: /\[ClipboardMonitor\] Event monitor unavailable, falling back to polling:/,
    eventCode: 'clipboard.event_monitor_unavailable',
  },
  {
    pattern: /\[ClipboardMonitor\] Failed to check clipboard:/,
    eventCode: 'clipboard.monitor_check_failed',
  },
  {
    pattern: /\[ClipboardMonitor\] Failed to handle clipboard event:/,
    eventCode: 'clipboard.monitor_event_failed',
  },
  {
    pattern: /\[ClipboardMonitor\] Callback error:/,
    eventCode: 'clipboard.monitor_callback_failed',
  },
  {
    pattern:
      /\[ClipboardMonitor\] Failed to (?:load|persist|clear) (?:persisted hash|denied changeCount):/,
    eventCode: 'clipboard.monitor_state_failed',
    fallbackReason: 'storage',
  },

  // History and local persistence.
  {
    pattern: /\[HistoryStorage\] Failed to initialize:/,
    eventCode: 'history.initialization_failed',
    fallbackReason: 'storage',
  },
  {
    pattern: /\[HistoryStorage\] Failed to load maxHistoryItems from config:/,
    eventCode: 'history.configuration_load_failed',
    fallbackReason: 'storage',
  },
  {
    pattern: /\[HistoryStorage\] History data import failed/,
    eventCode: 'history.import_failed',
    fallbackReason: 'storage',
  },
  {
    pattern: /\[HistoryStorage\] Failed to migrate AsyncStorage history to SQLite:/,
    eventCode: 'history.migration_failed',
    fallbackReason: 'storage',
  },
  {
    pattern: /\[HistoryStorage\] Failed to move file to history directory:/,
    eventCode: 'history.file_move_failed',
    fallbackReason: 'storage',
  },
  {
    pattern: /\[HistoryStorage\] Failed to delete history file director(?:y|ies):/,
    eventCode: 'history.file_delete_failed',
    fallbackReason: 'storage',
  },
  {
    pattern: /\[HistoryStorage\] Failed to delete history entry:/,
    eventCode: 'history.entry_delete_failed',
    fallbackReason: 'storage',
  },
  {
    pattern: /\[HistoryStorage\] Failed to clear history files:/,
    eventCode: 'history.clear_failed',
    fallbackReason: 'storage',
  },
  {
    pattern: /\[HistoryStorage\] Failed to (?:cleanup orphaned data|delete orphaned directory)/,
    eventCode: 'history.cleanup_failed',
    fallbackReason: 'storage',
  },
  {
    pattern: /\[HistoryStorage\] Error in change callback:/,
    eventCode: 'history.change_callback_failed',
  },
  {
    pattern: /\[DB\] App Group container unavailable/,
    eventCode: 'database.app_group_unavailable',
    fallbackReason: 'storage',
  },
  {
    pattern: /\[AppGroupSync\] failed:/,
    eventCode: 'app_group.settings_sync_failed',
    fallbackReason: 'storage',
  },
  {
    pattern: /\[AppGroupHistoryImport\] legacy payload migration failed:/,
    eventCode: 'app_group.legacy_history_migration_failed',
    fallbackReason: 'storage',
  },
  {
    pattern: /\[AppGroupHistoryImport\] failed:/,
    eventCode: 'app_group.history_import_failed',
    fallbackReason: 'storage',
  },

  // User-facing save actions.
  {
    pattern: /\[HomeView\] saveToGallery failed/,
    eventCode: 'home.gallery_save_failed',
    fallbackReason: 'storage',
  },
  {
    pattern: /\[HomeView\] saveFile failed:/,
    eventCode: 'home.file_save_failed',
    fallbackReason: 'storage',
  },
  {
    pattern: /\[HomeView\] saveAndPush failed:/,
    eventCode: 'home.save_and_push_failed',
  },
];

const REASON_RULES: Array<{ pattern: RegExp; reason: DiagnosticReason }> = [
  {
    pattern: /(?:\b401\b|unauthori[sz]ed|authentication|invalid credentials|\bauth\b)/i,
    reason: 'authentication',
  },
  { pattern: /(?:cancelled|canceled|\bcancel\b|aborted|\babort\b)/i, reason: 'cancelled' },
  {
    pattern: /(?:permission|not authorized|access denied|operation not permitted|\bdenied\b)/i,
    reason: 'permission_denied',
  },
  {
    pattern: /(?:certificate|\btls\b|\bssl\b|trust evaluation|secure connection)/i,
    reason: 'tls_or_certificate',
  },
  { pattern: /(?:timed out|timeout|etimedout)/i, reason: 'timeout' },
  { pattern: /(?:\b404\b|not found|recordnotfound)/i, reason: 'not_found' },
  {
    pattern: /(?:decode|decoding|invalid json|json parse|parse error|invalid response|malformed)/i,
    reason: 'invalid_response',
  },
  {
    pattern: /(?:sqlite|database|filesystem|file system|no such file|disk|storage|directory)/i,
    reason: 'storage',
  },
  {
    pattern:
      /(?:network|unreachable|offline|econnrefused|connection refused|connection reset|connection abort|connection closed|connection lost|could not connect|cannot connect|failed to connect|tcp connect|error sending request|no route to host|enotfound|\bdns\b|socket)/i,
    reason: 'network_unreachable',
  },
];

export function classifyDiagnosticReason(
  message: string,
  fallback: DiagnosticReason = 'unknown'
): DiagnosticReason {
  return REASON_RULES.find((rule) => rule.pattern.test(message))?.reason ?? fallback;
}

export function classifyDiagnosticEvent(
  message: string,
  level: 'debug' | 'info' | 'warn' | 'error'
): ClassifiedDiagnosticEvent | null {
  const rule = EVENT_RULES.find((candidate) => candidate.pattern.test(message));
  if (rule) {
    const isIssue = level === 'warn' || level === 'error' || rule.fallbackReason !== undefined;
    return {
      eventCode: rule.eventCode,
      reason: isIssue ? classifyDiagnosticReason(message, rule.fallbackReason) : null,
    };
  }

  if (level === 'warn' || level === 'error') {
    const reason = classifyDiagnosticReason(message);
    if (reason !== 'unknown') {
      return { eventCode: 'runtime.unclassified_issue', reason };
    }
  }

  return null;
}
