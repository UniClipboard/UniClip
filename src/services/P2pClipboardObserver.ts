import { AppState } from 'react-native';
import type { SendReport } from 'uc-engine';
import type { ClipboardContent } from '@/types/clipboard';
import { useSettingsStore } from '@/stores/settingsStore';
import { canAutoPushInBackground } from '@/utils/syncDirectionPolicy';
import { getCurrentNetworkContext } from './networkContext';
import { persistP2pDeliveryReport } from './P2pDeliveryState';
import { log } from './Logger';

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
    const p2p = require('uc-engine') as {
      observeClipboardChange(shouldDispatch: boolean): Promise<SendReport | null>;
    };
    const report = await p2p.observeClipboardChange(dispatch);
    if (report) await persistP2pDeliveryReport(content.profileHash, report);
    return report;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log.info('[P2pClipboardObserver] Clipboard observation failed; kept local:', detail);
    return null;
  }
}
