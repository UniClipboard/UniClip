/**
 * 后台运行 section（仅 Android,「后台运行」二级页）
 *
 * 拆为三张卡:「后台任务」(总开关、常驻通知、忽略电池优化)、「后台同步」(后台下载/
 * 上传)、「后台读取剪贴板」(悬浮窗;授予 READ_LOGS 后自动切换为事件驱动)。原先散落的 Alert.alert
 * 确认改为单个配置驱动的 Compose AlertDialog(挂在第一张卡的 dialogs 上;Compose
 * Dialog 是 window 级 overlay,挂载位置不影响展示)。失败回滚交给 store。
 */
import React, { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Linking } from 'react-native';
import {
  ListItem,
  Switch as ComposeSwitch,
  AlertDialog,
  TextButton,
  HorizontalDivider,
  Text as ComposeText,
} from '@expo/ui/jetpack-compose';
import { hasOverlayPermission, requestOverlayPermission } from 'clipboard-overlay';
import { useSettingsStore } from '@/stores';
import { useSettingsToast } from './SettingsToastContext';
import { SettingsSectionItem } from './SettingsSectionItem';

interface BgDialog {
  title: string;
  text: string;
  confirmLabel: string;
  onConfirm: () => void;
  dismissLabel?: string;
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
  const clipboardOverlay = useSettingsStore((s) => s.config?.enableClipboardOverlay ?? false);

  const [dialog, setDialog] = useState<BgDialog | null>(null);
  const [permBattery, setPermBattery] = useState(false);
  const hasBatteryOptRequested = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    import('native-util')
      .then(({ isIgnoringBatteryOptimizations }) => {
        setPermBattery(isIgnoringBatteryOptimizations());
      })
      .catch(() => {});
  }, []);

  const handleToggleBackgroundTasks = async (enabled: boolean) => {
    const store = useSettingsStore.getState();
    if (enabled) {
      if (store.isTempDisabledBackgroundTasks) {
        store.setTempDisabledBackgroundTasks(false);
        showMessage(t('toast.tasksRestored'), 'success');
        return;
      }
      setDialog({
        title: t('dialog.enableTasks.title'),
        text: t('dialog.enableTasks.text'),
        confirmLabel: t('dialog.enableTasks.confirm'),
        dismissLabel: t('action.cancel', { ns: 'common' }),
        onConfirm: async () => {
          try {
            await useSettingsStore.getState().setEnableBackgroundTasks(true);
            showMessage(t('toast.tasksEnabled'), 'success');
          } catch (error: unknown) {
            showMessage(error instanceof Error ? error.message : t('toast.setFailed'), 'error');
          }
        },
      });
      return;
    }

    try {
      await useSettingsStore.getState().setEnableBackgroundTasks(false);
      showMessage(t('toast.tasksDisabled'), 'success');
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

  const handleToggleClipboardOverlay = async (enabled: boolean) => {
    if (enabled && Platform.OS === 'android') {
      setDialog({
        title: t('dialog.enableOverlay.title'),
        text: t('dialog.enableOverlay.text'),
        confirmLabel: t('action.confirm', { ns: 'common' }),
        dismissLabel: t('action.cancel', { ns: 'common' }),
        onConfirm: async () => {
          if (!hasOverlayPermission()) {
            requestOverlayPermission();
            return;
          }
          try {
            await useSettingsStore.getState().setEnableClipboardOverlay(true);
            showMessage(t('toast.overlayEnabled'), 'success');
          } catch (error: unknown) {
            showMessage(error instanceof Error ? error.message : t('toast.setFailed'), 'error');
          }
        },
      });
      return;
    }

    try {
      await useSettingsStore.getState().setEnableClipboardOverlay(enabled);
      showMessage(enabled ? t('toast.overlayEnabled') : t('toast.overlayDisabled'), 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('toast.setFailed'), 'error');
    }
  };

  const handleToggleBattery = async () => {
    const { requestIgnoreBatteryOptimizations } = await import('native-util');
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
        title={t('tasks.cardTitle')}
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
            <ComposeText>{t('tasks.toggle.title')}</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <ComposeText>
              {isTempDisabled ? t('tasks.toggle.descTempDisabled') : t('tasks.toggle.descNormal')}
            </ComposeText>
          </ListItem.SupportingContent>
          <ListItem.TrailingContent>
            <ComposeSwitch
              value={backgroundTasksEnabled}
              onCheckedChange={handleToggleBackgroundTasks}
            />
          </ListItem.TrailingContent>
        </ListItem>

        <HorizontalDivider />

        <ListItem>
          <ListItem.HeadlineContent>
            <ComposeText>{t('tasks.notification.title')}</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <ComposeText>{t('tasks.notification.desc')}</ComposeText>
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
            <ComposeText>{t('tasks.battery.title')}</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <ComposeText>{t('tasks.battery.desc')}</ComposeText>
          </ListItem.SupportingContent>
          <ListItem.TrailingContent>
            <ComposeSwitch value={permBattery} onCheckedChange={handleToggleBattery} />
          </ListItem.TrailingContent>
        </ListItem>
      </SettingsSectionItem>

      <SettingsSectionItem title={t('sync.cardTitle')}>
        <ListItem>
          <ListItem.HeadlineContent>
            <ComposeText>{t('sync.download.title')}</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <ComposeText>{t('sync.download.desc')}</ComposeText>
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
            <ComposeText>{t('sync.upload.title')}</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <ComposeText>{t('sync.upload.desc')}</ComposeText>
          </ListItem.SupportingContent>
          <ListItem.TrailingContent>
            <ComposeSwitch
              value={backgroundTasksEnabled && backgroundUpload}
              onCheckedChange={handleToggleBackgroundUpload}
              enabled={backgroundTasksEnabled}
            />
          </ListItem.TrailingContent>
        </ListItem>
      </SettingsSectionItem>

      <SettingsSectionItem title={t('clipboard.cardTitle')}>
        <ListItem>
          <ListItem.HeadlineContent>
            <ComposeText>{t('clipboard.overlay.title')}</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <ComposeText>{t('clipboard.overlay.desc')}</ComposeText>
          </ListItem.SupportingContent>
          <ListItem.TrailingContent>
            <ComposeSwitch
              value={backgroundTasksEnabled && clipboardOverlay}
              onCheckedChange={handleToggleClipboardOverlay}
              enabled={backgroundTasksEnabled}
            />
          </ListItem.TrailingContent>
        </ListItem>
      </SettingsSectionItem>
    </>
  );
});
