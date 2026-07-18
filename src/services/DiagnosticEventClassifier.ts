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
  // Sync engine lifecycle and transport.
  { pattern: /\[SyncEngineStore\] Starting SyncEngine/, eventCode: 'sync.engine_starting' },
  {
    pattern: /\[SyncEngineStore\] Active server:.*\b(?:none|null|undefined)\b/i,
    eventCode: 'sync.active_server_missing',
  },
  { pattern: /\[SyncEngineStore\] Active server:/, eventCode: 'sync.active_server_available' },
  { pattern: /\[SyncEngine\] start\b/, eventCode: 'sync.started' },
  {
    pattern: /\[SyncEngine\] engineInit failed:/,
    eventCode: 'sync.engine_init_failed',
  },
  { pattern: /\[SyncEngine\] engineInit @/, eventCode: 'sync.engine_initialized' },
  {
    pattern: /\[SyncEngine\] engineSetServer failed:/,
    eventCode: 'sync.server_configuration_failed',
  },
  { pattern: /\[SyncEngine\] engineSetServer @/, eventCode: 'sync.server_configured' },
  {
    pattern: /\[SyncEngine\] engineApplyStaged threw:/,
    eventCode: 'sync.apply_staged_failed',
  },
  {
    pattern: /\[SyncEngine\] engineAcknowledgeLoopDetected threw:/,
    eventCode: 'sync.loop_acknowledge_failed',
  },
  {
    pattern: /\[SyncEngine\] engineSetSettings threw:/,
    eventCode: 'sync.settings_update_failed',
  },
  {
    pattern: /\[SyncEngine\] engineHandleNetworkRouteChanged threw:/,
    eventCode: 'sync.network_route_update_failed',
    fallbackReason: 'network_unreachable',
  },
  {
    pattern: /\[SyncEngine\] SSE route resolve failed:/,
    eventCode: 'sync.sse_route_resolve_failed',
    fallbackReason: 'network_unreachable',
  },
  {
    pattern: /\[SyncEngine\] SSE subscribe threw:/,
    eventCode: 'sync.sse_subscribe_failed',
    fallbackReason: 'network_unreachable',
  },
  { pattern: /\[SyncEngine\] SSE subscribing /, eventCode: 'sync.sse_subscribing' },
  { pattern: /\[SyncEngine\] SSE hello /, eventCode: 'sync.sse_connected' },
  { pattern: /\[SyncEngine\] SSE update -> pull/, eventCode: 'sync.sse_update_received' },
  { pattern: /\[SyncEngine\] SSE resync ->/, eventCode: 'sync.sse_resync_received' },
  {
    pattern: /\[SyncEngine\] SSE unavailable after /,
    eventCode: 'sync.sse_fallback_to_polling',
    fallbackReason: 'network_unreachable',
  },
  {
    pattern: /\[SyncEngine\] SSE disconnected /,
    eventCode: 'sync.sse_disconnected',
    fallbackReason: 'network_unreachable',
  },
  {
    pattern: /\[SyncEngine\] server unreachable /,
    eventCode: 'sync.server_offline',
    fallbackReason: 'network_unreachable',
  },
  { pattern: /\[SyncEngine\] server reachable again/, eventCode: 'sync.server_online' },
  {
    pattern: /\[SyncEngine\] op error \(auth\):/,
    eventCode: 'sync.authentication_failed',
    fallbackReason: 'authentication',
  },
  { pattern: /\[SyncEngine\] op error:/, eventCode: 'sync.operation_failed' },
  {
    pattern: /\[SyncEngine\] buildLocalContent failed:/,
    eventCode: 'sync.local_content_build_failed',
  },
  {
    pattern: /\[SyncEngine\] applyToDevice failed:/,
    eventCode: 'sync.apply_to_device_failed',
  },
  {
    pattern: /\[SyncEngine\] applied server->device:/,
    eventCode: 'sync.apply_to_device_succeeded',
  },
  {
    pattern: /\[SyncEngine(?:Store)?\] getDeviceClipboard failed:/,
    eventCode: 'sync.device_clipboard_read_failed',
  },
  {
    pattern: /\[SyncEngine\] Failed to write applied image to system clipboard:/,
    eventCode: 'sync.image_clipboard_write_failed',
  },
  {
    pattern: /\[SyncEngine\] Failed to add to history:/,
    eventCode: 'sync.history_add_failed',
    fallbackReason: 'storage',
  },
  {
    pattern: /\[SyncEngine\] Failed to mark pushed history item:/,
    eventCode: 'sync.history_mark_pushed_failed',
    fallbackReason: 'storage',
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

  // Legacy sync service paths still active for some backends.
  {
    pattern: /\[ClipboardSyncService\].*Silent fetch failed:/,
    eventCode: 'sync.fetch_failed',
  },
  {
    pattern: /\[ClipboardSyncService\].*foreground history refresh failed:/,
    eventCode: 'sync.history_refresh_failed',
    fallbackReason: 'storage',
  },
  {
    pattern: /\[ClipboardSyncService\].*Failed to (?:initialize|destroy) SyncManager:/,
    eventCode: 'sync.manager_lifecycle_failed',
  },
  {
    pattern: /\[ClipboardSyncService\].*Failed to start polling:/,
    eventCode: 'sync.polling_start_failed',
  },
  {
    pattern: /\[ClipboardSyncService\].*Auto-download failed:/,
    eventCode: 'sync.auto_download_failed',
  },
  {
    pattern: /\[ClipboardSyncService\].*Failed to add (?:to history|history item before download):/,
    eventCode: 'sync.history_add_failed',
    fallbackReason: 'storage',
  },
  {
    pattern: /\[ClipboardSyncService\].*(?:Auto-copy|Copy) failed:/,
    eventCode: 'sync.auto_copy_failed',
  },
  {
    pattern: /\[ClipboardSyncService\].*Auto-download completed/,
    eventCode: 'sync.auto_download_succeeded',
  },
  {
    pattern: /\[ClipboardSyncService\].*Copied to local clipboard/,
    eventCode: 'sync.auto_copy_succeeded',
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

  // Unscoped shared-service failures that otherwise appear as `general`.
  {
    pattern: /Failed to add auth header:/,
    eventCode: 'network.authorization_header_failed',
    fallbackReason: 'authentication',
  },
  {
    pattern: /\[APIClient\] HTTP Error - Status:/,
    eventCode: 'network.http_error',
  },
  {
    pattern: /Failed to (?:save|load|delete) credentials:/,
    eventCode: 'authentication.credential_storage_failed',
    fallbackReason: 'storage',
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
