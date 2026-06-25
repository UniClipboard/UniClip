/**
 * 权限管理 section（仅 Android）
 *
 * 通知/悬浮窗/短信/Shizuku/电池优化权限的状态展示与跳转申请。权限状态完全自包含
 * （挂载时刷新一次，提供手动刷新），不影响其它 section。
 */
import React, { memo, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Platform, Linking } from 'react-native';
import {
  Host,
  Card,
  Column,
  ListItem,
  Switch as ComposeSwitch,
  AlertDialog,
  TextButton,
  HorizontalDivider,
  Text as ComposeText,
} from '@expo/ui/jetpack-compose';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import { RefreshCw } from 'react-native-feather';
import { hasOverlayPermission, requestOverlayPermission } from 'clipboard-overlay';
import {
  isShizukuAvailable,
  hasShizukuPermission,
  requestShizukuPermission,
} from 'shizuku-clipboard';
import { useTheme } from '@/hooks/useTheme';
import { settingsStyles as styles } from './settingsStyles';

export const PermissionsSection = memo(function PermissionsSection() {
  const { theme } = useTheme();

  const [permNotification, setPermNotification] = useState(false);
  const [permOverlay, setPermOverlay] = useState(false);
  const [permSms, setPermSms] = useState(false);
  const [permBattery, setPermBattery] = useState(false);
  const [permShizuku, setPermShizuku] = useState(false);
  const [shizukuAvailable, setShizukuAvailable] = useState(false);
  const [isRefreshingPermissions, setIsRefreshingPermissions] = useState(false);
  const [showShizukuUnavailableDialog, setShowShizukuUnavailableDialog] = useState(false);
  const [showBatteryOptDialog, setShowBatteryOptDialog] = useState(false);
  const hasBatteryOptRequested = useRef(false);

  const refreshPermissions = async () => {
    if (Platform.OS !== 'android') return;
    setIsRefreshingPermissions(true);
    try {
      const { PermissionsAndroid } = require('react-native');
      const [notif, sms] = await Promise.all([
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS),
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS),
      ]);
      setPermNotification(notif);
      setPermOverlay(hasOverlayPermission());
      setPermSms(sms);
      const { isIgnoringBatteryOptimizations } = await import('native-util');
      setPermBattery(isIgnoringBatteryOptimizations());
      const shizukuUp = isShizukuAvailable();
      setShizukuAvailable(shizukuUp);
      setPermShizuku(shizukuUp && hasShizukuPermission());
    } catch (e) {
      console.warn('[Settings] Failed to check permissions:', e);
    } finally {
      setIsRefreshingPermissions(false);
    }
  };

  useEffect(() => {
    refreshPermissions();
  }, []);

  if (Platform.OS !== 'android') return null;

  return (
    <>
      <View style={styles.section}>
        <View style={[styles.sectionHeaderBase, styles.sectionHeaderRow]}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>权限管理</Text>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={refreshPermissions}
            disabled={isRefreshingPermissions}
          >
            <RefreshCw color={theme.colors.primary} width={16} height={16} />
          </TouchableOpacity>
        </View>

        <Host matchContents={{ vertical: true }} style={styles.hostFill}>
          <Card>
            <Column modifiers={[fillMaxWidth()]}>
              <ListItem>
                <ListItem.HeadlineContent>
                  <ComposeText>通知权限</ComposeText>
                </ListItem.HeadlineContent>
                <ListItem.TrailingContent>
                  <ComposeSwitch
                    value={permNotification}
                    onCheckedChange={() => Linking.openSettings()}
                  />
                </ListItem.TrailingContent>
              </ListItem>

              <HorizontalDivider />

              <ListItem>
                <ListItem.HeadlineContent>
                  <ComposeText>悬浮窗权限</ComposeText>
                </ListItem.HeadlineContent>
                <ListItem.SupportingContent>
                  <ComposeText>后台通过悬浮窗获取剪贴板所需</ComposeText>
                </ListItem.SupportingContent>
                <ListItem.TrailingContent>
                  <ComposeSwitch
                    value={permOverlay}
                    onCheckedChange={() => requestOverlayPermission()}
                  />
                </ListItem.TrailingContent>
              </ListItem>

              <HorizontalDivider />

              <ListItem>
                <ListItem.HeadlineContent>
                  <ComposeText>短信权限</ComposeText>
                </ListItem.HeadlineContent>
                <ListItem.SupportingContent>
                  <ComposeText>自动上传短信验证码所需</ComposeText>
                </ListItem.SupportingContent>
                <ListItem.TrailingContent>
                  <ComposeSwitch value={permSms} onCheckedChange={() => Linking.openSettings()} />
                </ListItem.TrailingContent>
              </ListItem>

              <HorizontalDivider />

              <ListItem>
                <ListItem.HeadlineContent>
                  <ComposeText>Shizuku 权限</ComposeText>
                </ListItem.HeadlineContent>
                <ListItem.SupportingContent>
                  <ComposeText>
                    {shizukuAvailable
                      ? '后台通过 Shizuku 获取剪贴板所需'
                      : 'Shizuku 未运行，请先启动 Shizuku'}
                  </ComposeText>
                </ListItem.SupportingContent>
                <ListItem.TrailingContent>
                  <ComposeSwitch
                    value={permShizuku}
                    onCheckedChange={() => {
                      if (!shizukuAvailable) {
                        setShowShizukuUnavailableDialog(true);
                        return;
                      }
                      if (!permShizuku) {
                        requestShizukuPermission();
                        // 延迟刷新权限状态（等待用户授权）
                        setTimeout(refreshPermissions, 2000);
                      }
                    }}
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
                  <ComposeSwitch
                    value={permBattery}
                    onCheckedChange={async () => {
                      const { requestIgnoreBatteryOptimizations } = await import('native-util');
                      if (hasBatteryOptRequested.current) {
                        setShowBatteryOptDialog(true);
                        return;
                      }
                      requestIgnoreBatteryOptimizations();
                      hasBatteryOptRequested.current = true;
                    }}
                  />
                </ListItem.TrailingContent>
              </ListItem>
            </Column>
          </Card>
        </Host>
      </View>

      <Host>
        {showShizukuUnavailableDialog && (
          <AlertDialog onDismissRequest={() => setShowShizukuUnavailableDialog(false)}>
            <AlertDialog.Title>
              <ComposeText>Shizuku 未运行</ComposeText>
            </AlertDialog.Title>
            <AlertDialog.Text>
              <ComposeText>
                请先安装并启动 Shizuku。{'\n\n'}非 Root 设备每次重启后需重新启动 Shizuku（Android
                11+ 可通过无线调试自行启动）。
              </ComposeText>
            </AlertDialog.Text>
            <AlertDialog.ConfirmButton>
              <TextButton
                onClick={() => {
                  Linking.openURL('https://shizuku.rikka.app/guide/setup/');
                  setShowShizukuUnavailableDialog(false);
                }}
              >
                <ComposeText>了解更多</ComposeText>
              </TextButton>
            </AlertDialog.ConfirmButton>
            <AlertDialog.DismissButton>
              <TextButton onClick={() => setShowShizukuUnavailableDialog(false)}>
                <ComposeText>取消</ComposeText>
              </TextButton>
            </AlertDialog.DismissButton>
          </AlertDialog>
        )}

        {showBatteryOptDialog && (
          <AlertDialog onDismissRequest={() => setShowBatteryOptDialog(false)}>
            <AlertDialog.Title>
              <ComposeText>无法唤起系统弹窗</ComposeText>
            </AlertDialog.Title>
            <AlertDialog.Text>
              <ComposeText>
                系统限制每次安装仅允许弹出一次电池优化请求，请前往系统设置手动关闭电池优化。
              </ComposeText>
            </AlertDialog.Text>
            <AlertDialog.ConfirmButton>
              <TextButton
                onClick={() => {
                  Linking.openSettings();
                  setShowBatteryOptDialog(false);
                }}
              >
                <ComposeText>前往设置</ComposeText>
              </TextButton>
            </AlertDialog.ConfirmButton>
            <AlertDialog.DismissButton>
              <TextButton onClick={() => setShowBatteryOptDialog(false)}>
                <ComposeText>取消</ComposeText>
              </TextButton>
            </AlertDialog.DismissButton>
          </AlertDialog>
        )}
      </Host>
    </>
  );
});
