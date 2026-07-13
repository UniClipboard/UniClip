/**
 * 后台运行 section（仅 Android,「后台运行」二级页）
 *
 * 卡片一「后台自动同步」只有一个总开关:开启时批量打开下载/上传/常驻通知,并依次引导
 * 三项系统权限(忽略电池优化、通知权限、悬浮窗权限;跳系统页的两项靠 AppState 监听下一次
 * 回到前台来串行,避免连续拉起多个系统 Activity 互相打断)。
 * 卡片二「高级选项」始终展开,是原来的 5 个细分开关(常驻通知/电池优化/下载/上传/悬浮窗),
 * 供需要精细控制的用户使用;末尾附一行「自动检测本机复制」状态,如实反映 READ_LOGS 是否已授权
 * (应用内无法申请,仅能靠电脑 adb 授予)。未授权时点击该行会把 adb 授权命令复制到剪贴板,方便
 * 愿意折腾的用户直接粘贴执行;避免用户以为开了悬浮窗开关就等于开启了后台自动读取。
 * Alert.alert 确认统一走单个配置驱动的 Compose AlertDialog(挂在卡片一上;Compose
 * Dialog 是 window 级 overlay,挂载位置不影响展示)。失败回滚交给 store。
 */
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Linking, AppState } from 'react-native';
import {
  Column,
  ListItem,
  Switch as ComposeSwitch,
  AlertDialog,
  TextButton,
  HorizontalDivider,
  SingleChoiceSegmentedButtonRow,
  SegmentedButton,
  Text as ComposeText,
  Spacer,
} from '@expo/ui/jetpack-compose';
import {
  clickable,
  fillMaxWidth,
  height as heightModifier,
  padding,
} from '@expo/ui/jetpack-compose/modifiers';
import * as Clipboard from 'expo-clipboard';
import { useClipboardStore, useSettingsStore } from '@/stores';
import {
  changeClipboardAccessMethod,
  getClipboardAccessAdapter,
} from '@/utils/androidBackgroundClipboardAccess';
import type { ClipboardAuthorizationState } from '@/utils/backgroundClipboardAccess';
import { refreshBackgroundClipboardAuthorization } from '@/utils/backgroundClipboardAccess';
import { useSettingsToast } from './SettingsToastContext';
import { SettingsSectionItem } from './SettingsSectionItem';

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

  const isTempDisabled = useSettingsStore((s) => s.isTempDisabledBackgroundTasks);
  const backgroundTasksEnabled = useSettingsStore(
    (s) => (s.config?.enableBackgroundTasks ?? false) && !s.isTempDisabledBackgroundTasks
  );
  const foregroundNotification = useSettingsStore(
    (s) => s.config?.enableForegroundNotification ?? true
  );
  const backgroundDownload = useSettingsStore((s) => s.config?.enableBackgroundDownload ?? false);
  const backgroundUpload = useSettingsStore((s) => s.config?.enableBackgroundUpload ?? false);
  const clipboardAccessMethod = useSettingsStore(
    (s) => s.config?.clipboardAccessMethod ?? 'overlay'
  );

  const [dialog, setDialog] = useState<BgDialog | null>(null);
  const [permBattery, setPermBattery] = useState(false);
  const [clipboardAccessState, setClipboardAccessState] = useState<ClipboardAuthorizationState>(
    () => getClipboardAccessAdapter(clipboardAccessMethod).getAuthorizationState()
  );
  const hasBatteryOptRequested = useRef(false);

  const refreshBatteryPermission = () => {
    if (Platform.OS !== 'android') return;
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
    if (Platform.OS !== 'android') return;
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
    const { isIgnoringBatteryOptimizations, requestIgnoreBatteryOptimizations } =
      await import('android-util');
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
      useSettingsStore.getState().config?.clipboardAccessMethod ?? 'overlay'
    );
    await adapter.activate();
    const authorization = adapter.getAuthorizationState();
    if (authorization.status === 'unavailable' && authorization.setupUrl) {
      await Linking.openURL(authorization.setupUrl);
    } else if (authorization.status !== 'ready' && adapter.requestAuthorization()) {
      await waitForNextActiveState();
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
      if (Platform.OS === 'android') {
        const { PermissionsAndroid } = require('react-native');
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

  const handleSetClipboardAccessMethod = async (method: 'overlay' | 'shizuku') => {
    try {
      await changeClipboardAccessMethod(
        clipboardAccessMethod,
        method,
        (nextMethod) =>
          useSettingsStore.getState().updateConfig({ clipboardAccessMethod: nextMethod }),
        () => useClipboardStore.getState().restartMonitoring()
      );
      setClipboardAccessState(getClipboardAccessAdapter(method).getAuthorizationState());
      showMessage(t('toast.clipboardAccessChanged'), 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('toast.setFailed'), 'error');
    }
  };

  const handleAuthorizeClipboardAccess = async () => {
    try {
      const adapter = getClipboardAccessAdapter(clipboardAccessMethod);
      const authorization = adapter.getAuthorizationState();
      if (authorization.setupUrl) {
        await Linking.openURL(authorization.setupUrl);
      } else {
        adapter.requestAuthorization();
      }
      refreshClipboardAccessState();
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('toast.setFailed'), 'error');
    }
  };

  const handleClipboardMonitoringSetup = async () => {
    if (!clipboardAccessState.setupCommand) return;
    try {
      await Clipboard.setStringAsync(clipboardAccessState.setupCommand);
      showMessage(t('advanced.autoDetect.copied'), 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('toast.setFailed'), 'error');
    }
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

  if (Platform.OS !== 'android') return null;

  return (
    <>
      <SettingsSectionItem
        title={t('main.cardTitle')}
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
        <ListItem>
          <ListItem.HeadlineContent>
            <ComposeText>{t('main.cardTitle')}</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <ComposeText>
              {isTempDisabled ? t('main.toggle.descTempDisabled') : t('main.toggle.descNormal')}
            </ComposeText>
          </ListItem.SupportingContent>
          <ListItem.TrailingContent>
            <ComposeSwitch
              value={backgroundTasksEnabled}
              onCheckedChange={handleToggleBackgroundTasks}
            />
          </ListItem.TrailingContent>
        </ListItem>
      </SettingsSectionItem>

      <SettingsSectionItem title={t('advanced.cardTitle')}>
        <ListItem>
          <ListItem.HeadlineContent>
            <ComposeText>{t('advanced.notification.title')}</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <ComposeText>{t('advanced.notification.desc')}</ComposeText>
          </ListItem.SupportingContent>
          <ListItem.TrailingContent>
            <ComposeSwitch
              value={backgroundTasksEnabled && foregroundNotification}
              onCheckedChange={handleToggleForegroundNotification}
              enabled={backgroundTasksEnabled}
            />
          </ListItem.TrailingContent>
        </ListItem>

        <HorizontalDivider />

        <ListItem>
          <ListItem.HeadlineContent>
            <ComposeText>{t('advanced.battery.title')}</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <ComposeText>{t('advanced.battery.desc')}</ComposeText>
          </ListItem.SupportingContent>
          <ListItem.TrailingContent>
            <ComposeSwitch value={permBattery} onCheckedChange={handleToggleBattery} />
          </ListItem.TrailingContent>
        </ListItem>

        <HorizontalDivider />

        <ListItem>
          <ListItem.HeadlineContent>
            <ComposeText>{t('advanced.download.title')}</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <ComposeText>{t('advanced.download.desc')}</ComposeText>
          </ListItem.SupportingContent>
          <ListItem.TrailingContent>
            <ComposeSwitch
              value={backgroundTasksEnabled && backgroundDownload}
              onCheckedChange={handleToggleBackgroundDownload}
              enabled={backgroundTasksEnabled}
            />
          </ListItem.TrailingContent>
        </ListItem>

        <HorizontalDivider />

        <ListItem>
          <ListItem.HeadlineContent>
            <ComposeText>{t('advanced.upload.title')}</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <ComposeText>{t('advanced.upload.desc')}</ComposeText>
          </ListItem.SupportingContent>
          <ListItem.TrailingContent>
            <ComposeSwitch
              value={backgroundTasksEnabled && backgroundUpload}
              onCheckedChange={handleToggleBackgroundUpload}
              enabled={backgroundTasksEnabled}
            />
          </ListItem.TrailingContent>
        </ListItem>

        <HorizontalDivider />

        <Column modifiers={[fillMaxWidth(), padding(16, 12, 16, 12)]}>
          <ComposeText style={{ fontSize: 15, fontWeight: '500' }}>
            {t('advanced.clipboardAccess.title')}
          </ComposeText>
          <Spacer modifiers={[heightModifier(12)]} />
          <SingleChoiceSegmentedButtonRow modifiers={[fillMaxWidth()]}>
            {(['overlay', 'shizuku'] as const).map((method) => (
              <SegmentedButton
                key={method}
                selected={clipboardAccessMethod === method}
                onClick={() => handleSetClipboardAccessMethod(method)}
              >
                <SegmentedButton.Label>
                  <ComposeText>{t(`advanced.clipboardAccess.method.${method}`)}</ComposeText>
                </SegmentedButton.Label>
              </SegmentedButton>
            ))}
          </SingleChoiceSegmentedButtonRow>
        </Column>

        <HorizontalDivider />

        <ListItem
          modifiers={
            clipboardAccessState.status === 'ready' ||
            clipboardAccessState.status === 'incompatible'
              ? []
              : [clickable(handleAuthorizeClipboardAccess)]
          }
        >
          <ListItem.HeadlineContent>
            <ComposeText>{t('advanced.clipboardAccess.authorization.title')}</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <ComposeText>
              {t(`advanced.clipboardAccess.authorization.${clipboardAccessState.status}`)}
            </ComposeText>
          </ListItem.SupportingContent>
        </ListItem>

        <HorizontalDivider />

        <ListItem
          modifiers={
            clipboardAccessState.setupCommand ? [clickable(handleClipboardMonitoringSetup)] : []
          }
        >
          <ListItem.HeadlineContent>
            <ComposeText>{t('advanced.autoDetect.title')}</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <ComposeText>
              {clipboardAccessState.monitoringStatus === 'ready'
                ? t('advanced.autoDetect.enabled')
                : clipboardAccessState.setupCommand
                  ? t('advanced.autoDetect.setupRequired')
                  : t('advanced.autoDetect.authorizationRequired')}
            </ComposeText>
          </ListItem.SupportingContent>
        </ListItem>
      </SettingsSectionItem>
    </>
  );
});
