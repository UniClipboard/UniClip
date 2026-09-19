import { File } from 'expo-file-system';
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import {
  configureP2pSpaceActivation,
  getP2pSpaceSetupCoordinator,
} from './p2pSpaceSetupCoordinator';
import {
  configureAppRuntime as configureRuntimeDependencies,
  getAppRuntime as getUnconfiguredAppRuntime,
} from './appRuntime';
import { nativeEngine } from '@/platform/engine/nativeEngine';
import { configureUnifiedEngineService, getUnifiedEngineService } from '@/platform/engine';
import { configureUnifiedSpaceService, getUnifiedSpaceService } from '@/features/space';
import {
  configureClipboardObserver,
  configureOutboundDeliveryCoordinator,
  configureUnifiedContentService,
  getUnifiedContentService,
  getOutboundDeliveryCoordinator,
} from '@/features/transfer';
import { clipboardManager, useClipboardStore } from '@/features/clipboard';
import { persistP2pDeliveryReport } from '@/features/transfer';
import { configureAnalyticsConsent, useSettingsStore } from '@/features/settings';
import { configureRelaySettings } from '@/features/relaySettings';
import { configureNetworkContextChangeListener } from '@/platform/network';
import { configurePostHogAnalytics } from '@/support/observability';
import { useStatisticsStore } from '@/stores/statisticsStore';
import { configureOutboundShareHandoffManager, createPendingShareStore } from '@/features/transfer';
import {
  configureUnifiedSyncRuntime,
  getUnifiedSyncRuntime,
  P2pSyncAdapter,
} from '@/features/sync';
import { configureProductionLanServerService } from '@/features/lan-servers/production';
import { getLanServerService } from '@/features/lan-servers';
import { LanSyncAdapter } from '@/features/lan-sync';
import { applyLanRemoteContent } from '@/features/lan-sync/production';
import { prepareTempFilePath } from '@/platform/files';
import { sanitizeDataName } from '@/utils/fileName';

let configured = false;

export function configureAppRuntime(): void {
  if (configured) return;

  configureUnifiedEngineService(nativeEngine);
  configureProductionLanServerService();
  configureOutboundDeliveryCoordinator(getUnifiedEngineService());
  configureUnifiedContentService({
    readClipboard: () => clipboardManager.getClipboardContent(),
    readFileBytes: (uri) => new File(uri).bytes(),
    p2p: nativeEngine,
    completeOutboundDelivery: (send) => getOutboundDeliveryCoordinator().run(send),
    persistDelivery: persistP2pDeliveryReport,
  });
  configureOutboundShareHandoffManager(createPendingShareStore());
  configureClipboardObserver((content, dispatch) =>
    getUnifiedSyncRuntime().observeClipboardChange(content, dispatch)
  );
  configureP2pSpaceActivation(() => getUnconfiguredAppRuntime().activateP2p());
  configureUnifiedSpaceService(nativeEngine, (operation) =>
    getP2pSpaceSetupCoordinator().run(operation)
  );
  configureUnifiedSyncRuntime(
    [
      new P2pSyncAdapter({
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        engine: getUnifiedEngineService(),
        space: getUnifiedSpaceService(),
        content: getUnifiedContentService(),
        clipboard: {
          observeClipboardChange: (dispatch) => nativeEngine.observeClipboardChange(dispatch),
          persistDelivery: persistP2pDeliveryReport,
        },
      }),
      new LanSyncAdapter({
        async getServer(serverId?: string) {
          const config = useSettingsStore.getState().config;
          const targetServerId = serverId ?? config?.lanServers[0]?.id;
          if (!targetServerId) return null;
          return getLanServerService().getDraft(targetServerId);
        },
        async getServers() {
          const serverIds =
            useSettingsStore.getState().config?.lanServers.map(({ id }) => id) ?? [];
          return Promise.all(serverIds.map((serverId) => getLanServerService().getDraft(serverId)));
        },
        readClipboard: () => clipboardManager.getClipboardContent(),
        applyRemoteContent: applyLanRemoteContent,
        preparePayloadTempUri: (profileHash, dataName) =>
          prepareTempFilePath(`${profileHash}-${sanitizeDataName(dataName)}`),
      }),
    ],
    'p2p'
  );
  configureAnalyticsConsent(nativeEngine);
  configureRelaySettings({
    saveCustomRelayNode: nativeEngine.saveCustomRelayNode,
    async rebuildRelayEndpoint(): Promise<void> {
      await getUnifiedSyncRuntime().restart();
    },
  });
  configurePostHogAnalytics({
    loadState: () => nativeEngine.getAnalyticsState(),
    subscribe: (listener) => nativeEngine.subscribeAnalyticsState(listener),
  });
  configureNetworkContextChangeListener(() => getUnconfiguredAppRuntime().refresh());
  configureRuntimeDependencies({
    settingsStore: useSettingsStore,
    clipboardStore: useClipboardStore,
    sync: getUnifiedSyncRuntime,
    statisticsStore: useStatisticsStore,
    applicationVersion: () => Application.nativeApplicationVersion ?? null,
  });
  configured = true;
}

export function getAppRuntime() {
  configureAppRuntime();
  return getUnconfiguredAppRuntime();
}
