/**
 * 后台运行 section（仅 Android,「后台运行」二级页）
 *
 * 卡片一「后台自动同步」只有一个总开关:开启时批量打开下载/上传/常驻通知,并依次引导
 * 三项系统权限(忽略电池优化、通知权限、悬浮窗权限;跳系统页的两项靠 AppState 监听下一次
 * 回到前台来串行,避免连续拉起多个系统 Activity 互相打断)。
 * 总开关放在顶部 SettingsHeroCard(开启时 primaryContainer 强调),其下三组 grouped 列表:
 * 剪贴板读取 / 后台同步 / 运行保障。后台剪贴板访问通过横向分页 Bottom Sheet 比较并选择
 * 定时轮询、READ_LOGS 事件检测或 Shizuku；缺少的授权步骤由所选 adapter 自己处理。
 * Alert.alert 确认统一走单个配置驱动的 Compose AlertDialog(挂在第一个分组上;Compose
 * Dialog 是 window 级 overlay,挂载位置不影响展示)。失败回滚交给 store。
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, AppState, PermissionsAndroid } from 'react-native';
import {
  AlertDialog,
  Column,
  Spacer,
  TextButton,
  Text as ComposeText,
} from '@expo/ui/jetpack-compose';
import { useClipboardStore, useSettingsStore } from '@/stores';
import type { ClipboardAccessMethod } from '@/types/settings';
import {
  changeClipboardAccessMethod,
  getClipboardAccessAdapter,
} from '@/utils/androidBackgroundClipboardAccess';
import type { ClipboardAuthorizationState } from '@/utils/backgroundClipboardAccess';
import {
  getBackgroundClipboardSetupState,
  refreshBackgroundClipboardAuthorization,
} from '@/utils/backgroundClipboardAccess';
import { useSettingsToast } from '../SettingsToastContext';
import { fillMaxWidth, height as heightModifier } from '@expo/ui/jetpack-compose/modifiers';
import { SettingsSectionItem } from '../SettingsSectionItem';
import { SettingsHeroCard } from './SettingsHeroCard';
import { SettingsListRow } from './SettingsListRow';
import { SettingsSwitchRow } from './SettingsSwitchRow';
import { useClipboardAccessMethodSheet } from '../ClipboardAccessMethodSheet';
import { resolveAdbAuthorizationCheck } from '../ClipboardAccessMethodSheet.state';

interface BgDialog {
  title: string;
  text: string;
  confirmLabel: string;
  onConfirm: () => void;
  dismissLabel?: string;
}

/** 等待下一次回到前台(用于串联跳系统设置页的权限申请),超时兜底避免永久挂起。 */
function waitForNextActiveState(timeoutMs = 60_000): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      sub.remove();
      clearTimeout(timer);
      resolve();
    };
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') finish();
    });
    const timer = setTimeout(finish, timeoutMs);
  });
}

export const BackgroundSection = memo(function BackgroundSection() {
  const { t } = useTranslation('settingsBackground');
  const showMessage = useSettingsToast();
  const { openMethodSheet, openAdbSetupSheet, closeSheet } = useClipboardAccessMethodSheet();

  const isTempDisabled = useSettingsStore((s) => s.isTempDisabledBackgroundTasks);
  const backgroundTasksEnabled = useSettingsStore(
    (s) => (s.config?.enableBackgroundTasks ?? false) && !s.isTempDisabledBackgroundTasks
  );
  const foregroundNotification = useSettingsStore(
    (s) => s.config?.enableForegroundNotification ?? true
  );
  const autoApplyRemote = useSettingsStore((s) => s.config?.autoApplyRemote ?? true);
  const autoPushLocal = useSettingsStore((s) => s.config?.autoPushLocal ?? true);
  const backgroundDownload = useSettingsStore((s) => s.config?.enableBackgroundDownload ?? false);
  const backgroundUpload = useSettingsStore((s) => s.config?.enableBackgroundUpload ?? false);
  const backgroundSyncNetwork = useSettingsStore((s) => s.config?.backgroundSyncNetwork ?? 'any');
  const clipboardAccessMethod = useSettingsStore(
    (s) => s.config?.clipboardAccessMethod ?? 'overlay-polling'
  );

  const [dialog, setDialog] = useState<BgDialog | null>(null);
  const [permBattery, setPermBattery] = useState(false);
  const [adbCommandCopied, setAdbCommandCopied] = useState(false);
  const [clipboardAccessState, setClipboardAccessState] = useState<ClipboardAuthorizationState>(
    () => getClipboardAccessAdapter(clipboardAccessMethod).getAuthorizationState()
  );
  const clipboardSetupState = getBackgroundClipboardSetupState(clipboardAccessState);
  const hasBatteryOptRequested = useRef(false);

  const refreshBatteryPermission = () => {
    import('android-util')
      .then(({ isIgnoringBatteryOptimizations }) => {
        setPermBattery(isIgnoringBatteryOptimizations());
      })
      .catch(() => {});
  };

  const refreshClipboardAccessState = useCallback(() => {
    setClipboardAccessState(
      getClipboardAccessAdapter(clipboardAccessMethod).getAuthorizationState()
    );
  }, [clipboardAccessMethod]);

  useEffect(() => {
    refreshBatteryPermission();
    refreshClipboardAccessState();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refreshBatteryPermission();
        refreshClipboardAccessState();
      }
    });
    return () => sub.remove();
  }, [refreshClipboardAccessState]);

  useEffect(() => {
    const adapter = getClipboardAccessAdapter(clipboardAccessMethod);
    const subscription = adapter.addAuthorizationChangeListener(() => {
      void refreshBackgroundClipboardAuthorization(adapter, setClipboardAccessState, () =>
        useClipboardStore.getState().restartMonitoring()
      );
    });
    return () => subscription.remove();
  }, [clipboardAccessMethod]);

  /** 开启总开关后依次引导:忽略电池优化 → 通知权限 → 悬浮窗权限。 */
  const runPermissionOnboarding = async () => {
    const { isIgnoringBatteryOptimizations, requestIgnoreBatteryOptimizations } = await import(
      'android-util'
    );
    if (!isIgnoringBatteryOptimizations()) {
      requestIgnoreBatteryOptimizations();
      hasBatteryOptRequested.current = true;
      await waitForNextActiveState();
      setPermBattery(isIgnoringBatteryOptimizations());
    }

    try {
      const { PermissionsAndroid } = require('react-native');
      const hasNotificationPerm = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
      );
      if (!hasNotificationPerm) {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      }
    } catch {
      // 忽略:部分系统版本无此权限项
    }

    const adapter = getClipboardAccessAdapter(
      useSettingsStore.getState().config?.clipboardAccessMethod ?? 'overlay-polling'
    );
    await adapter.activate();
    const authorization = adapter.getAuthorizationState();
    if (authorization.status === 'unavailable' || authorization.status === 'unauthorized') {
      const result = await adapter.continueSetup();
      if (result === 'waiting-for-return') await waitForNextActiveState();
    }
    refreshClipboardAccessState();
  };

  const handleToggleBackgroundTasks = async (enabled: boolean) => {
    const store = useSettingsStore.getState();
    if (enabled) {
      if (store.isTempDisabledBackgroundTasks) {
        store.setTempDisabledBackgroundTasks(false);
        showMessage(t('toast.autoSyncRestored'), 'success');
        return;
      }
      setDialog({
        title: t('dialog.enableAutoSync.title'),
        text: t('dialog.enableAutoSync.text'),
        confirmLabel: t('dialog.enableAutoSync.confirm'),
        dismissLabel: t('action.cancel', { ns: 'common' }),
        onConfirm: async () => {
          try {
            await useSettingsStore.getState().updateConfig({
              enableBackgroundTasks: true,
              enableBackgroundDownload: true,
              enableBackgroundUpload: true,
              enableForegroundNotification: true,
            });
            showMessage(t('toast.autoSyncEnabled'), 'success');
          } catch (error: unknown) {
            showMessage(error instanceof Error ? error.message : t('toast.setFailed'), 'error');
            return;
          }
          void runPermissionOnboarding();
        },
      });
      return;
    }

    try {
      await useSettingsStore.getState().setEnableBackgroundTasks(false);
      showMessage(t('toast.autoSyncDisabled'), 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('toast.setFailed'), 'error');
    }
  };

  const handleToggleForegroundNotification = async (enabled: boolean) => {
    if (!enabled) {
      setDialog({
        title: t('dialog.disableNotification.title'),
        text: t('dialog.disableNotification.text'),
        confirmLabel: t('dialog.disableNotification.confirm'),
        dismissLabel: t('action.cancel', { ns: 'common' }),
        onConfirm: async () => {
          try {
            await useSettingsStore.getState().updateConfig({ enableForegroundNotification: false });
          } catch (error: unknown) {
            showMessage(error instanceof Error ? error.message : t('toast.setFailed'), 'error');
          }
        },
      });
      return;
    }

    try {
      await useSettingsStore.getState().updateConfig({ enableForegroundNotification: true });
      const granted = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
      );
      if (!granted) {
        setDialog({
          title: t('dialog.missingNotificationPermission.title'),
          text: t('dialog.missingNotificationPermission.text'),
          confirmLabel: t('dialog.missingNotificationPermission.confirm'),
          dismissLabel: t('dialog.missingNotificationPermission.dismiss'),
          onConfirm: () => Linking.openSettings(),
        });
      }
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('toast.setFailed'), 'error');
    }
  };

  const handleToggleBackgroundDownload = async (enabled: boolean) => {
    try {
      await useSettingsStore.getState().setEnableBackgroundDownload(enabled);
      showMessage(enabled ? t('toast.downloadEnabled') : t('toast.downloadDisabled'), 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('toast.setFailed'), 'error');
    }
  };

  const handleToggleBackgroundUpload = async (enabled: boolean) => {
    if (enabled) {
      setDialog({
        title: t('dialog.enableUpload.title'),
        text: t('dialog.enableUpload.text'),
        confirmLabel: t('dialog.enableUpload.confirm'),
        dismissLabel: t('action.cancel', { ns: 'common' }),
        onConfirm: async () => {
          try {
            await useSettingsStore.getState().setEnableBackgroundUpload(true);
            showMessage(t('toast.uploadEnabled'), 'success');
          } catch (error: unknown) {
            showMessage(error instanceof Error ? error.message : t('toast.setFailed'), 'error');
          }
        },
      });
      return;
    }

    try {
      await useSettingsStore.getState().setEnableBackgroundUpload(false);
      showMessage(t('toast.uploadDisabled'), 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('toast.setFailed'), 'error');
    }
  };

  const handleToggleCellularBackgroundSync = async (enabled: boolean) => {
    try {
      await useSettingsStore
        .getState()
        .updateConfig({ backgroundSyncNetwork: enabled ? 'any' : 'wifi' });
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('toast.setFailed'), 'error');
    }
  };

  const openAdbSetupGuide = (stage: 'instructions' | 'copied' | 'notDetected') => {
    const command =
      getClipboardAccessAdapter('overlay-event').getAuthorizationState().setupCommand ?? '';
    openAdbSetupSheet({
      stage,
      command,
      onCopy: () => void continueClipboardAccessSetup(),
      onCheck: () => void checkAdbAuthorization(),
    });
  };

  const handleSetClipboardAccessMethod = async (method: ClipboardAccessMethod) => {
    if (method === clipboardAccessMethod) return;

    try {
      setAdbCommandCopied(false);
      const setupResult = await changeClipboardAccessMethod(
        clipboardAccessMethod,
        method,
        async (nextMethod) => {
          const result = await useSettingsStore
            .getState()
            .updateConfig({ clipboardAccessMethod: nextMethod });
          if (!result.ok) throw new Error(result.error);
        },
        () => useClipboardStore.getState().restartMonitoring()
      );
      const adapter = getClipboardAccessAdapter(method);
      showMessage(t('toast.clipboardAccessChanged'), 'success');
      await handleClipboardAccessSetupResult(adapter, setupResult);
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('toast.setFailed'), 'error');
    }
  };

  const handleClipboardAccessSetupResult = async (
    adapter: ReturnType<typeof getClipboardAccessAdapter>,
    result: Awaited<ReturnType<typeof adapter.continueSetup>>
  ) => {
    if (result === 'waiting-for-return') await waitForNextActiveState();
    if (result === 'failed') {
      showMessage(t('advanced.clipboardAccess.setup.failed'), 'error');
      return;
    }
    if (result === 'command-copied') {
      setAdbCommandCopied(true);
      showMessage(t('advanced.clipboardAccess.setup.commandCopied'), 'success');
      openAdbSetupGuide('copied');
    }
    if (result === 'completed') {
      showMessage(t('advanced.clipboardAccess.setup.completed'), 'success');
    }
    await refreshBackgroundClipboardAuthorization(adapter, setClipboardAccessState, () =>
      useClipboardStore.getState().restartMonitoring()
    );
  };

  const continueClipboardAccessSetup = async () => {
    try {
      const adapter = getClipboardAccessAdapter(clipboardAccessMethod);
      const result = await adapter.continueSetup();
      await handleClipboardAccessSetupResult(adapter, result);
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('toast.setFailed'), 'error');
    }
  };

  const checkAdbAuthorization = async () => {
    try {
      const adapter = getClipboardAccessAdapter('overlay-event');
      const nextState = adapter.getAuthorizationState();
      const outcome = resolveAdbAuthorizationCheck(nextState);
      setClipboardAccessState(nextState);

      if (outcome === 'show-adb-guide') {
        openAdbSetupGuide('notDetected');
        return;
      }
      if (outcome === 'continue-access-setup') {
        setAdbCommandCopied(false);
        closeSheet();
        const result = await adapter.continueSetup();
        await handleClipboardAccessSetupResult(adapter, result);
        return;
      }

      await useClipboardStore.getState().restartMonitoring();
      setAdbCommandCopied(false);
      closeSheet();
      showMessage(t('advanced.clipboardAccess.setup.completed'), 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('toast.setFailed'), 'error');
    }
  };

  const handleOpenClipboardMethodSheet = () => {
    openMethodSheet({
      selectedMethod: clipboardAccessMethod,
      onSelect: handleSetClipboardAccessMethod,
    });
  };

  const handleContinueClipboardAccessSetup = () => {
    if (clipboardSetupState.issue === 'monitoring-setup-required') {
      if (adbCommandCopied) {
        void checkAdbAuthorization();
      } else {
        openAdbSetupGuide('instructions');
      }
      return;
    }
    if (clipboardSetupState.issue === 'system-restriction') {
      setDialog({
        title: t('advanced.clipboardAccess.restriction.title'),
        text: t('advanced.clipboardAccess.restriction.text'),
        confirmLabel: t('advanced.clipboardAccess.restriction.confirm'),
        dismissLabel: t('action.cancel', { ns: 'common' }),
        onConfirm: () => void continueClipboardAccessSetup(),
      });
      return;
    }
    void continueClipboardAccessSetup();
  };

  const handleToggleBattery = async () => {
    const { requestIgnoreBatteryOptimizations } = await import('android-util');
    if (hasBatteryOptRequested.current) {
      setDialog({
        title: t('dialog.batteryFallback.title'),
        text: t('dialog.batteryFallback.text'),
        confirmLabel: t('dialog.batteryFallback.confirm'),
        dismissLabel: t('action.cancel', { ns: 'common' }),
        onConfirm: () => Linking.openSettings(),
      });
      return;
    }
    requestIgnoreBatteryOptimizations();
    hasBatteryOptRequested.current = true;
  };

  return (
    <Column modifiers={[fillMaxWidth()]}>
      {/* 总开关:卡片内边距调小,由 ListItem 自带的内边距对齐文字 */}
      <SettingsHeroCard tone={backgroundTasksEnabled ? 'primary' : 'neutral'} contentPadding={8}>
        <SettingsSwitchRow
          testID="background-tasks"
          title={t('main.cardTitle')}
          description={
            isTempDisabled ? t('main.toggle.descTempDisabled') : t('main.toggle.descNormal')
          }
          value={backgroundTasksEnabled}
          onValueChange={(enabled) => void handleToggleBackgroundTasks(enabled)}
        />
      </SettingsHeroCard>

      <Spacer modifiers={[heightModifier(24)]} />
      <SettingsSectionItem
        variant="grouped"
        title={t('advanced.groups.clipboardAccess')}
        dialogs={
          dialog && (
            <AlertDialog onDismissRequest={() => setDialog(null)}>
              <AlertDialog.Title>
                <ComposeText>{dialog.title}</ComposeText>
              </AlertDialog.Title>
              <AlertDialog.Text>
                <ComposeText>{dialog.text}</ComposeText>
              </AlertDialog.Text>
              <AlertDialog.ConfirmButton>
                <TextButton
                  onClick={() => {
                    const fn = dialog.onConfirm;
                    setDialog(null);
                    fn();
                  }}
                >
                  <ComposeText>{dialog.confirmLabel}</ComposeText>
                </TextButton>
              </AlertDialog.ConfirmButton>
              {dialog.dismissLabel ? (
                <AlertDialog.DismissButton>
                  <TextButton onClick={() => setDialog(null)}>
                    <ComposeText>{dialog.dismissLabel}</ComposeText>
                  </TextButton>
                </AlertDialog.DismissButton>
              ) : null}
            </AlertDialog>
          )
        }
      >
        <SettingsListRow
          key="clipboardAccess"
          testID="background-clipboard-access"
          title={t('advanced.clipboardAccess.title')}
          description={t(`advanced.clipboardAccess.description.${clipboardAccessMethod}`)}
          trailing={{ value: t(`advanced.clipboardAccess.method.${clipboardAccessMethod}`) }}
          onPress={handleOpenClipboardMethodSheet}
        />
        {clipboardSetupState.status === 'action-required' ? (
          <SettingsListRow
            key="clipboardAccessIssue"
            testID="background-clipboard-access-issue"
            destructive
            title={t(`advanced.clipboardAccess.issue.${clipboardSetupState.issue}`)}
            description={t(
              `advanced.clipboardAccess.issueDescription.${clipboardSetupState.issue}`
            )}
            trailing={{
              action: t(
                clipboardSetupState.issue === 'monitoring-setup-required' && adbCommandCopied
                  ? 'advanced.clipboardAccess.action.check'
                  : `advanced.clipboardAccess.action.${clipboardSetupState.issue}`
              ),
            }}
            onPress={handleContinueClipboardAccessSetup}
          />
        ) : null}
      </SettingsSectionItem>

      <Spacer modifiers={[heightModifier(24)]} />
      <SettingsSectionItem
        variant="grouped"
        title={t('advanced.groups.sync')}
        footer={t('main.footer')}
      >
        <SettingsSwitchRow
          key="download"
          title={t('advanced.download.title')}
          description={t('advanced.download.desc')}
          value={backgroundTasksEnabled && autoApplyRemote && backgroundDownload}
          disabled={!(backgroundTasksEnabled && autoApplyRemote)}
          onValueChange={(enabled) => void handleToggleBackgroundDownload(enabled)}
        />
        <SettingsSwitchRow
          key="upload"
          title={t('advanced.upload.title')}
          description={t('advanced.upload.desc')}
          value={backgroundTasksEnabled && autoPushLocal && backgroundUpload}
          disabled={!(backgroundTasksEnabled && autoPushLocal)}
          onValueChange={(enabled) => void handleToggleBackgroundUpload(enabled)}
        />
        <SettingsSwitchRow
          key="network"
          title={t('advanced.network.title')}
          description={t('advanced.network.desc')}
          value={backgroundSyncNetwork === 'any'}
          disabled={!backgroundTasksEnabled}
          onValueChange={(enabled) => void handleToggleCellularBackgroundSync(enabled)}
        />
      </SettingsSectionItem>

      <Spacer modifiers={[heightModifier(24)]} />
      <SettingsSectionItem variant="grouped" title={t('advanced.groups.reliability')}>
        <SettingsSwitchRow
          key="notification"
          title={t('advanced.notification.title')}
          description={t('advanced.notification.desc')}
          value={backgroundTasksEnabled && foregroundNotification}
          disabled={!backgroundTasksEnabled}
          onValueChange={(enabled) => void handleToggleForegroundNotification(enabled)}
        />
        <SettingsSwitchRow
          key="battery"
          title={t('advanced.battery.title')}
          description={t('advanced.battery.desc')}
          value={permBattery}
          onValueChange={() => void handleToggleBattery()}
        />
      </SettingsSectionItem>
    </Column>
  );
});
