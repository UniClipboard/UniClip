import { File } from 'expo-file-system';
import * as Application from 'expo-application';
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
  configureOutboundShareHandoffManager,
  configureUnifiedContentService,
  getOutboundDeliveryCoordinator,
  getUnifiedContentService,
} from '@/features/transfer';
import { clipboardManager, useClipboardStore } from '@/features/clipboard';
import { persistP2pDeliveryReport } from '@/features/transfer';
import { configureAnalyticsConsent, useSettingsStore } from '@/features/settings';
import { configureNetworkContextChangeListener } from '@/platform/network';
import { configurePostHogAnalytics } from '@/support/observability';
import { useStatisticsStore } from '@/stores/statisticsStore';
import { importFileToHistory } from '@/utils/uploadFile';
import {
  claimOutboundShareJobs,
  completeOutboundShareJob,
  releaseOutboundShareJob,
} from 'app-group-store';

let configured = false;

export function configureAppRuntime(): void {
  if (configured) return;

  configureUnifiedEngineService(nativeEngine);
  configureOutboundDeliveryCoordinator(getUnifiedEngineService());
  configureUnifiedContentService({
    readClipboard: () => clipboardManager.getClipboardContent(),
    readFileBytes: (uri) => new File(uri).bytes(),
    p2p: nativeEngine,
    completeOutboundDelivery: (send) => getOutboundDeliveryCoordinator().run(send),
    persistDelivery: persistP2pDeliveryReport,
  });
  configureOutboundShareHandoffManager({
    claimJobs: claimOutboundShareJobs,
    completeJob: completeOutboundShareJob,
    releaseJob: releaseOutboundShareJob,
    importFile: importFileToHistory,
    sendImportedAsset: (asset, profileHash, options) =>
      getUnifiedContentService().sendImportedAsset(asset, profileHash, options),
  });
  configureClipboardObserver((dispatch) => nativeEngine.observeClipboardChange(dispatch));
  configureP2pSpaceActivation(() => getUnconfiguredAppRuntime().activateP2p());
  configureUnifiedSpaceService(nativeEngine, (operation) =>
    getP2pSpaceSetupCoordinator().run(operation)
  );
  configureAnalyticsConsent(nativeEngine);
  configurePostHogAnalytics({
    loadState: () => nativeEngine.getAnalyticsState(),
    subscribe: (listener) => nativeEngine.subscribeAnalyticsState(listener),
  });
  configureNetworkContextChangeListener(() => {
    void getUnconfiguredAppRuntime().refresh();
  });
  configureRuntimeDependencies({
    settingsStore: useSettingsStore,
    clipboardStore: useClipboardStore,
    engine: getUnifiedEngineService,
    space: getUnifiedSpaceService,
    statisticsStore: useStatisticsStore,
    applicationVersion: () => Application.nativeApplicationVersion ?? null,
  });
  configured = true;
}

export function getAppRuntime() {
  configureAppRuntime();
  return getUnconfiguredAppRuntime();
}
