/**
 * 后台运行 section（仅 Android）
 *
 * 后台任务总开关及其子项（常驻通知、后台下载/上传、悬浮窗/Shizuku 获取剪贴板），以及
 * 与之强相关的权限（忽略电池优化）。原先散落的 Alert.alert 确认改为单个配置驱动的
 * Compose AlertDialog(内部化到 item);含 Shizuku/悬浮窗互斥联动。失败回滚交给 store。
 */
import React, { memo, useEffect, useRef, useState } from 'react';
import { Platform, Linking } from 'react-native';
import {
  ListItem,
  Switch as ComposeSwitch,
  AlertDialog,
  TextButton,
  HorizontalDivider,
  Text as ComposeText,
} from '@expo/ui/jetpack-compose';
import { clickable } from '@expo/ui/jetpack-compose/modifiers';
import { hasOverlayPermission, requestOverlayPermission } from 'clipboard-overlay';
import {
  isShizukuAvailable,
  hasShizukuPermission,
  requestShizukuPermission,
} from 'shizuku-clipboard';
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
  const shizukuClipboard = useSettingsStore((s) => s.config?.enableShizukuClipboard ?? false);

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
        showMessage('已恢复后台任务', 'success');
        return;
      }
      setDialog({
        title: '开启后台任务',
        text: '启用后台任务后，应用将在后台持续运行相关服务，大幅增加电量消耗，强烈建议按需开启。\n\n如有需要，可以在系统设置中将 UniClip 的电池优化设为「不受限制」，并在多任务界面锁定 UniClip，减少系统关闭后台任务的概率。',
        confirmLabel: '确认开启',
        dismissLabel: '取消',
        onConfirm: async () => {
          try {
            await useSettingsStore.getState().setEnableBackgroundTasks(true);
            showMessage('已启用后台任务', 'success');
          } catch (error: unknown) {
            showMessage(error instanceof Error ? error.message : '设置失败', 'error');
          }
        },
      });
      return;
    }

    try {
      await useSettingsStore.getState().setEnableBackgroundTasks(false);
      showMessage('已禁用后台任务', 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  const handleToggleForegroundNotification = async (enabled: boolean) => {
    if (!enabled) {
      setDialog({
        title: '关闭常驻通知',
        text: '关闭常驻通知会降低后台服务稳定性，系统终止后台任务的可能性增大。',
        confirmLabel: '确认关闭',
        dismissLabel: '取消',
        onConfirm: async () => {
          try {
            await useSettingsStore.getState().updateConfig({ enableForegroundNotification: false });
          } catch (error: unknown) {
            showMessage(error instanceof Error ? error.message : '设置失败', 'error');
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
            title: '缺少通知权限',
            text: '未授予通知权限，常驻通知可能无法显示。建议前往系统设置允许通知权限。',
            confirmLabel: '前往设置',
            dismissLabel: '稍后再说',
            onConfirm: () => Linking.openSettings(),
          });
        }
      }
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  const handleToggleBackgroundDownload = async (enabled: boolean) => {
    try {
      await useSettingsStore.getState().setEnableBackgroundDownload(enabled);
      showMessage(enabled ? '已启用后台下载远程' : '已禁用后台下载远程', 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  const handleToggleBackgroundUpload = async (enabled: boolean) => {
    if (enabled) {
      setDialog({
        title: '开启后台上传本地剪贴板',
        text: '无需启用此选项，UniClip 也支持从选中文字弹出的菜单直接上传文字。\n\nAndroid 10 及以上的系统，应用在后台无法直接获取本地剪贴板内容，你可能需要启用悬浮窗或使用其他工具绕过此限制。',
        confirmLabel: '确认开启',
        dismissLabel: '取消',
        onConfirm: async () => {
          try {
            await useSettingsStore.getState().setEnableBackgroundUpload(true);
            showMessage('已启用后台上传本地', 'success');
          } catch (error: unknown) {
            showMessage(error instanceof Error ? error.message : '设置失败', 'error');
          }
        },
      });
      return;
    }

    try {
      await useSettingsStore.getState().setEnableBackgroundUpload(false);
      showMessage('已禁用后台上传本地', 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  const handleToggleClipboardOverlay = async (enabled: boolean) => {
    if (enabled && Platform.OS === 'android') {
      setDialog({
        title: '启用悬浮窗获取剪贴板',
        text: '启用后，应用将通过不可见的悬浮窗在后台获取剪贴板内容。这可能导致部分应用因焦点问题产生功能异常以及其他问题。\n\n如果您可以通过其他工具授予 UniClip 后台读取剪贴板的权限，建议关闭此选项。',
        confirmLabel: '确定',
        dismissLabel: '取消',
        onConfirm: async () => {
          if (!hasOverlayPermission()) {
            requestOverlayPermission();
            return;
          }
          try {
            await useSettingsStore.getState().setEnableClipboardOverlay(true);
            showMessage('已启用悬浮窗获取剪贴板', 'success');
          } catch (error: unknown) {
            showMessage(error instanceof Error ? error.message : '设置失败', 'error');
          }
        },
      });
      return;
    }

    try {
      await useSettingsStore.getState().setEnableClipboardOverlay(enabled);
      showMessage(enabled ? '已启用悬浮窗获取剪贴板' : '已禁用悬浮窗获取剪贴板', 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  const handleToggleShizukuClipboard = async (enabled: boolean) => {
    if (enabled && Platform.OS === 'android') {
      if (!isShizukuAvailable()) {
        setDialog({
          title: 'Shizuku 未运行',
          text: '请先安装并启动 Shizuku。\n\n非 Root 设备每次重启后需重新启动 Shizuku（Android 11+ 可通过无线调试自行启动）。',
          confirmLabel: '了解更多',
          dismissLabel: '取消',
          onConfirm: () => Linking.openURL('https://shizuku.rikka.app/guide/setup/'),
        });
        return;
      }

      if (!hasShizukuPermission()) {
        const requested = requestShizukuPermission();
        if (!requested) {
          setDialog({
            title: '权限请求失败',
            text: '无法请求 Shizuku 权限，请确认 Shizuku 版本支持。',
            confirmLabel: '确定',
            onConfirm: () => {},
          });
          return;
        }
        showMessage('请在 Shizuku 弹窗中授予权限后重新启用', 'info');
        return;
      }

      try {
        // 启用 Shizuku 时自动关闭悬浮窗方式
        if (useSettingsStore.getState().config?.enableClipboardOverlay) {
          await useSettingsStore.getState().setEnableClipboardOverlay(false);
        }
        await useSettingsStore.getState().setEnableShizukuClipboard(true);
        showMessage('已启用 Shizuku 获取剪贴板', 'success');
      } catch (error: unknown) {
        showMessage(error instanceof Error ? error.message : '设置失败', 'error');
      }
      return;
    }

    try {
      await useSettingsStore.getState().setEnableShizukuClipboard(enabled);
      showMessage(enabled ? '已启用 Shizuku 获取剪贴板' : '已禁用 Shizuku 获取剪贴板', 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  const handleToggleBattery = async () => {
    const { requestIgnoreBatteryOptimizations } = await import('native-util');
    if (hasBatteryOptRequested.current) {
      setDialog({
        title: '无法唤起系统弹窗',
        text: '系统限制每次安装仅允许弹出一次电池优化请求，请前往系统设置手动关闭电池优化。',
        confirmLabel: '前往设置',
        dismissLabel: '取消',
        onConfirm: () => Linking.openSettings(),
      });
      return;
    }
    requestIgnoreBatteryOptimizations();
    hasBatteryOptRequested.current = true;
  };

  if (Platform.OS !== 'android') return null;

  return (
    <SettingsSectionItem
      title="后台运行"
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
          <ComposeText>后台任务</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.SupportingContent>
          <ComposeText>
            {isTempDisabled ? '已临时停止，重启 APP 后恢复开启状态' : '关闭后将停止所有后台任务'}
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
          <ComposeText>后台服务常驻通知</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.SupportingContent>
          <ComposeText>启用后会增加后台服务的稳定性</ComposeText>
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
          <ComposeText>后台下载远程</ComposeText>
        </ListItem.HeadlineContent>
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
          <ComposeText>后台上传本地</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.TrailingContent>
          <ComposeSwitch
            value={backgroundTasksEnabled && backgroundUpload}
            onCheckedChange={handleToggleBackgroundUpload}
            enabled={backgroundTasksEnabled}
          />
        </ListItem.TrailingContent>
      </ListItem>

      <HorizontalDivider />

      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>后台时通过悬浮窗获取剪贴板</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.TrailingContent>
          <ComposeSwitch
            value={backgroundTasksEnabled && clipboardOverlay}
            onCheckedChange={handleToggleClipboardOverlay}
            enabled={backgroundTasksEnabled}
          />
        </ListItem.TrailingContent>
      </ListItem>

      <HorizontalDivider />

      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>后台时通过 Shizuku 获取剪贴板</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.SupportingContent>
          <ComposeText modifiers={[clickable(() => Linking.openURL('https://shizuku.rikka.app/'))]}>
            前往 Shizuku 官网
          </ComposeText>
        </ListItem.SupportingContent>
        <ListItem.TrailingContent>
          <ComposeSwitch
            value={backgroundTasksEnabled && shizukuClipboard}
            onCheckedChange={handleToggleShizukuClipboard}
            enabled={backgroundTasksEnabled}
          />
        </ListItem.TrailingContent>
      </ListItem>

      <HorizontalDivider />

      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>忽略电池优化</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.SupportingContent>
          <ComposeText>防止省电模式中断后台同步</ComposeText>
        </ListItem.SupportingContent>
        <ListItem.TrailingContent>
          <ComposeSwitch value={permBattery} onCheckedChange={handleToggleBattery} />
        </ListItem.TrailingContent>
      </ListItem>
    </SettingsSectionItem>
  );
});
