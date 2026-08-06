import { AppState } from 'react-native';
import type { SendReport } from '@/platform/engine';
import type { ClipboardContent } from '@/types/clipboard';
import { useSettingsStore } from '@/features/settings';
import { canAutoPushInBackground } from '@/utils/syncDirectionPolicy';
import { getCurrentNetworkContext } from '@/platform/network';
import { persistP2pDeliveryReport } from './deliveryState';
import { createLogger } from '@/support/observability';

const log = createLogger('P2pClipboardObserver');

let observeClipboardChange:
  | ((content: ClipboardContent, dispatch: boolean) => Promise<SendReport | null>)
  | null = null;

export function configureClipboardObserver(
  observe: (content: ClipboardContent, dispatch: boolean) => Promise<SendReport | null>
): void {
  observeClipboardChange = observe;
}

export async function notifyDeviceClipboardChanged(
  content: ClipboardContent
): Promise<SendReport | null> {
  const settings = useSettingsStore.getState();
  const config = settings.config;
  const appIsBackground = AppState.currentState !== 'active';
  const dispatch =
    (appIsBackground
      ? canAutoPushInBackground(
          config,
          settings.isTempDisabledBackgroundTasks,
          getCurrentNetworkContext()
        )
      : config?.autoPushLocal ?? true) &&
    (content.type === 'Text' || content.type === 'Image');

  try {
    if (!observeClipboardChange) throw new Error('The clipboard observer is not configured');
    const report = await observeClipboardChange(content, dispatch);
    if (report) await persistP2pDeliveryReport(content.profileHash, report);
    return report;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log.info('Clipboard observation failed; kept local:', detail);
    return null;
  }
}
