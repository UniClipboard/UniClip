/**
 * Headless JS task started by the native SMS receiver (tryWrite) or by the notification's Copy
 * action after it copied the code (no tryWrite).
 *
 * Android 10+ silently drops clipboard writes from an unfocused app, so a background write only
 * counts when the app's own background clipboard access (overlay / Shizuku) verified it. Only a
 * copy known to have happened is recorded in history and offered to the clipboard observer, which
 * uploads or not according to the user's sync settings; otherwise the notification keeps its Copy
 * action. The code is never logged.
 */
import { markSmsCodeCopied } from 'sms-verification-code';
import { getAppRuntime } from '@/app/runtime/composition';
import { useClipboardStore } from '@/features/clipboard';
import { useSettingsStore } from '@/features/settings';
import { createLogger, initLogger } from '@/support/observability';
import { getBackgroundClipboardAdapter } from '@/utils/androidBackgroundClipboardAccess';

const log = createLogger('SmsCodeReceivedTask');

async function writeThroughBackgroundAccess(code: string): Promise<boolean> {
  const adapter = getBackgroundClipboardAdapter('write');
  if (!adapter) return false;
  try {
    return await adapter.setString(code);
  } catch {
    return false;
  }
}

export default async function smsCodeReceivedTask({
  code,
  tryWrite,
}: {
  code?: string;
  tryWrite?: boolean;
}): Promise<void> {
  if (!code) return;
  try {
    initLogger();
    const settings = useSettingsStore.getState();
    if (!settings.isLoaded) await settings.loadConfig();
    await getAppRuntime().start();

    if (tryWrite && !(await writeThroughBackgroundAccess(code))) {
      log.info('Background clipboard write is not available; waiting for the Copy action');
      return;
    }
    // The clipboard already holds the code. Recording updates the monitor's last-seen hash, so
    // the monitor's own read of it is not counted again.
    await useClipboardStore.getState().recordCopiedText(code);
    markSmsCodeCopied(code);
  } catch (error) {
    log.error(`Failed to handle a received SMS code: ${error instanceof Error ? error.name : 'unknown'}`);
  }
}
