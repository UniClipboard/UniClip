/**
 * 权限管理 section（仅 Android）
 *
 * 通知/悬浮窗/短信/电池优化权限的状态展示与跳转申请。权限状态完全自包含
 * （挂载时刷新一次，提供手动刷新），不影响其它 section。
 */
import React, { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { useTheme } from '@/hooks/useTheme';
import { settingsStyles as styles } from './settingsStyles';
import { log } from '@/services/Logger';

export const PermissionsSection = memo(function PermissionsSection() {
  const { t } = useTranslation('settingsPermissions');
  const { theme } = useTheme();

  const [permNotification, setPermNotification] = useState(false);
  const [permOverlay, setPermOverlay] = useState(false);
  const [permSms, setPermSms] = useState(false);
  const [permBattery, setPermBattery] = useState(false);
  const [isRefreshingPermissions, setIsRefreshingPermissions] = useState(false);
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
    } catch (e) {
      log.warn('[Settings] Failed to check permissions:', e);
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
          <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>
            {t('section.title')}
          </Text>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={refreshPermissions}
            disabled={isRefreshingPermissions}
          >
            <RefreshCw color={theme.colors.accent} width={16} height={16} />
          </TouchableOpacity>
        </View>

        <Host matchContents={{ vertical: true }} style={styles.hostFill}>
          <Card>
            <Column modifiers={[fillMaxWidth()]}>
              <ListItem>
                <ListItem.HeadlineContent>
                  <ComposeText>{t('notification.title')}</ComposeText>
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
                  <ComposeText>{t('overlay.title')}</ComposeText>
                </ListItem.HeadlineContent>
                <ListItem.SupportingContent>
                  <ComposeText>{t('overlay.description')}</ComposeText>
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
                  <ComposeText>{t('sms.title')}</ComposeText>
                </ListItem.HeadlineContent>
                <ListItem.SupportingContent>
                  <ComposeText>{t('sms.description')}</ComposeText>
                </ListItem.SupportingContent>
                <ListItem.TrailingContent>
                  <ComposeSwitch value={permSms} onCheckedChange={() => Linking.openSettings()} />
                </ListItem.TrailingContent>
              </ListItem>

              <HorizontalDivider />

              <ListItem>
                <ListItem.HeadlineContent>
                  <ComposeText>{t('battery.title')}</ComposeText>
                </ListItem.HeadlineContent>
                <ListItem.SupportingContent>
                  <ComposeText>{t('battery.description')}</ComposeText>
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
        {showBatteryOptDialog && (
          <AlertDialog onDismissRequest={() => setShowBatteryOptDialog(false)}>
            <AlertDialog.Title>
              <ComposeText>{t('batteryDialog.title')}</ComposeText>
            </AlertDialog.Title>
            <AlertDialog.Text>
              <ComposeText>{t('batteryDialog.message')}</ComposeText>
            </AlertDialog.Text>
            <AlertDialog.ConfirmButton>
              <TextButton
                onClick={() => {
                  Linking.openSettings();
                  setShowBatteryOptDialog(false);
                }}
              >
                <ComposeText>{t('action.openSettings')}</ComposeText>
              </TextButton>
            </AlertDialog.ConfirmButton>
            <AlertDialog.DismissButton>
              <TextButton onClick={() => setShowBatteryOptDialog(false)}>
                <ComposeText>{t('action.cancel', { ns: 'common' })}</ComposeText>
              </TextButton>
            </AlertDialog.DismissButton>
          </AlertDialog>
        )}
      </Host>
    </>
  );
});
