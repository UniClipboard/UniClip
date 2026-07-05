/**
 * 调试 section
 *
 * 含 4 个调试开关，以及仅由调试触发的「短信测试」「统计信息」两个底部表单与结果弹窗。
 * 作为 item:无独立 Host,这些 modal/dialog 作为 item 内 overlay 渲染（见 SettingsSectionItem.dialogs），
 * 其状态/handler 一并内聚到本组件。
 */
import React, { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import {
  Column,
  Row,
  ListItem,
  Switch as ComposeSwitch,
  Button,
  TextButton,
  OutlinedTextField,
  AlertDialog,
  ModalBottomSheet,
  Spacer,
  HorizontalDivider,
  Text as ComposeText,
  useNativeState,
} from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  width as widthModifier,
  paddingAll,
  height as heightModifier,
} from '@expo/ui/jetpack-compose/modifiers';
import { useSettingsStore } from '@/stores';
import { extractVerificationCode } from '@/tasks/SmsUploadTask';
import { useSettingsToast } from './SettingsToastContext';
import { SettingsSectionItem } from './SettingsSectionItem';

export const DebugSection = memo(function DebugSection() {
  const { t } = useTranslation('settingsAbout');
  const showMessage = useSettingsToast();

  const debugMode = useSettingsStore((s) => s.config?.debugMode ?? false);
  const debugOverlayVisible = useSettingsStore((s) => s.config?.debugOverlayVisible ?? false);
  const debugUrlScheme = useSettingsStore((s) => s.config?.debugUrlScheme ?? false);
  const debugUpdateCheckNoLimit = useSettingsStore(
    (s) => s.config?.debugUpdateCheckNoLimit ?? false
  );

  const [showSmsTestModal, setShowSmsTestModal] = useState(false);
  const [smsTestInput, setSmsTestInput] = useState('');
  const [smsTestResult, setSmsTestResult] = useState<{ title: string; message: string } | null>(
    null
  );
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [statsText, setStatsText] = useState('');
  const smsTestNativeState = useNativeState(smsTestInput);

  const handleToggleDebugMode = async (enabled: boolean) => {
    try {
      await useSettingsStore.getState().updateConfig({ debugMode: enabled });
      showMessage(enabled ? t('debug.modeEnabled') : t('debug.modeDisabled'), 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('error.saveFailed'), 'error');
    }
  };

  const handleToggleDebugOverlayVisible = async (enabled: boolean) => {
    try {
      await useSettingsStore.getState().updateConfig({ debugOverlayVisible: enabled });
      showMessage(
        enabled ? t('debug.overlayVisibleToast') : t('debug.overlayHiddenToast'),
        'success'
      );
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('error.saveFailed'), 'error');
    }
  };

  const handleToggleDebugUrlScheme = async (enabled: boolean) => {
    try {
      await useSettingsStore.getState().updateConfig({ debugUrlScheme: enabled });
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('error.saveFailed'), 'error');
    }
  };

  const handleToggleDebugUpdateCheckNoLimit = async (enabled: boolean) => {
    try {
      await useSettingsStore.getState().updateConfig({ debugUpdateCheckNoLimit: enabled });
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('error.saveFailed'), 'error');
    }
  };

  const handleTestSmsCode = () => {
    const code = extractVerificationCode(smsTestInput);
    setSmsTestResult(
      code
        ? { title: t('sms.extractSuccessTitle'), message: t('sms.codeResult', { code }) }
        : { title: t('sms.extractFailTitle'), message: t('sms.extractFailMessage') }
    );
  };

  const handleShowStatistics = async () => {
    const { useStatisticsStore } = await import('@/stores/statisticsStore');
    const store = useStatisticsStore.getState();
    if (!store.isLoaded) {
      await store.load();
    }
    setStatsText(useStatisticsStore.getState().getStatisticsText());
    setShowStatsModal(true);
  };

  const handleCopyStatistics = async () => {
    const Clipboard = await import('expo-clipboard');
    await Clipboard.setStringAsync(statsText);
    setShowStatsModal(false);
    showMessage(t('stats.copied'), 'success');
  };

  return (
    <SettingsSectionItem
      title={t('debug.title')}
      dialogs={
        <>
          {/* 测试验证码短信底部表单 */}
          {showSmsTestModal && (
            <ModalBottomSheet onDismissRequest={() => setShowSmsTestModal(false)}>
              <Column modifiers={[paddingAll(24), fillMaxWidth()]}>
                <ComposeText style={{ typography: 'titleLarge' }}>{t('sms.title')}</ComposeText>
                <Spacer modifiers={[heightModifier(16)]} />
                <OutlinedTextField
                  value={smsTestNativeState}
                  onValueChange={setSmsTestInput}
                  modifiers={[fillMaxWidth()]}
                >
                  <OutlinedTextField.Placeholder>
                    <ComposeText>{t('sms.placeholder')}</ComposeText>
                  </OutlinedTextField.Placeholder>
                </OutlinedTextField>
                <Spacer modifiers={[heightModifier(16)]} />
                <Row modifiers={[fillMaxWidth()]} horizontalArrangement="end">
                  <TextButton onClick={() => setShowSmsTestModal(false)}>
                    <ComposeText>{t('action.cancel', { ns: 'common' })}</ComposeText>
                  </TextButton>
                  <Spacer modifiers={[widthModifier(8)]} />
                  <Button onClick={handleTestSmsCode}>
                    <ComposeText>{t('sms.test')}</ComposeText>
                  </Button>
                </Row>
              </Column>
            </ModalBottomSheet>
          )}

          {/* 统计信息底部表单 */}
          {showStatsModal && (
            <ModalBottomSheet onDismissRequest={() => setShowStatsModal(false)}>
              <Column modifiers={[paddingAll(24), fillMaxWidth()]}>
                <ComposeText style={{ typography: 'titleLarge' }}>{t('stats.title')}</ComposeText>
                <Spacer modifiers={[heightModifier(16)]} />
                <ComposeText>{statsText}</ComposeText>
                <Spacer modifiers={[heightModifier(16)]} />
                <Row modifiers={[fillMaxWidth()]} horizontalArrangement="end">
                  <TextButton onClick={() => setShowStatsModal(false)}>
                    <ComposeText>{t('action.close', { ns: 'common' })}</ComposeText>
                  </TextButton>
                  <Spacer modifiers={[widthModifier(8)]} />
                  <Button onClick={handleCopyStatistics}>
                    <ComposeText>{t('action.copy', { ns: 'common' })}</ComposeText>
                  </Button>
                </Row>
              </Column>
            </ModalBottomSheet>
          )}

          {/* 短信提取结果 */}
          {smsTestResult && (
            <AlertDialog onDismissRequest={() => setSmsTestResult(null)}>
              <AlertDialog.Title>
                <ComposeText>{smsTestResult.title}</ComposeText>
              </AlertDialog.Title>
              <AlertDialog.Text>
                <ComposeText>{smsTestResult.message}</ComposeText>
              </AlertDialog.Text>
              <AlertDialog.ConfirmButton>
                <TextButton onClick={() => setSmsTestResult(null)}>
                  <ComposeText>{t('action.confirm', { ns: 'common' })}</ComposeText>
                </TextButton>
              </AlertDialog.ConfirmButton>
            </AlertDialog>
          )}
        </>
      }
    >
      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>{t('debug.modeLabel')}</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.TrailingContent>
          <ComposeSwitch value={debugMode} onCheckedChange={handleToggleDebugMode} />
        </ListItem.TrailingContent>
      </ListItem>

      {debugMode && Platform.OS === 'android' && (
        <>
          <HorizontalDivider />
          <ListItem>
            <ListItem.HeadlineContent>
              <ComposeText>{t('debug.overlayLabel')}</ComposeText>
            </ListItem.HeadlineContent>
            <ListItem.SupportingContent>
              <ComposeText>{t('debug.overlayDesc')}</ComposeText>
            </ListItem.SupportingContent>
            <ListItem.TrailingContent>
              <ComposeSwitch
                value={debugOverlayVisible}
                onCheckedChange={handleToggleDebugOverlayVisible}
              />
            </ListItem.TrailingContent>
          </ListItem>
        </>
      )}

      {debugMode && (
        <>
          <HorizontalDivider />
          <ListItem>
            <ListItem.HeadlineContent>
              <ComposeText>{t('debug.urlSchemeLabel')}</ComposeText>
            </ListItem.HeadlineContent>
            <ListItem.TrailingContent>
              <ComposeSwitch value={debugUrlScheme} onCheckedChange={handleToggleDebugUrlScheme} />
            </ListItem.TrailingContent>
          </ListItem>
        </>
      )}

      {debugMode && (
        <>
          <HorizontalDivider />
          <ListItem>
            <ListItem.HeadlineContent>
              <ComposeText>{t('sms.title')}</ComposeText>
            </ListItem.HeadlineContent>
            <ListItem.TrailingContent>
              <Button
                onClick={() => {
                  setSmsTestInput('');
                  setShowSmsTestModal(true);
                }}
              >
                <ComposeText>{t('sms.test')}</ComposeText>
              </Button>
            </ListItem.TrailingContent>
          </ListItem>
        </>
      )}

      {debugMode && (
        <>
          <HorizontalDivider />
          <ListItem>
            <ListItem.HeadlineContent>
              <ComposeText>{t('debug.updateNoLimitLabel')}</ComposeText>
            </ListItem.HeadlineContent>
            <ListItem.SupportingContent>
              <ComposeText>{t('debug.updateNoLimitDesc')}</ComposeText>
            </ListItem.SupportingContent>
            <ListItem.TrailingContent>
              <ComposeSwitch
                value={debugUpdateCheckNoLimit}
                onCheckedChange={handleToggleDebugUpdateCheckNoLimit}
              />
            </ListItem.TrailingContent>
          </ListItem>
        </>
      )}

      {debugMode && (
        <>
          <HorizontalDivider />
          <ListItem>
            <ListItem.HeadlineContent>
              <ComposeText>{t('stats.title')}</ComposeText>
            </ListItem.HeadlineContent>
            <ListItem.TrailingContent>
              <Button onClick={handleShowStatistics}>
                <ComposeText>{t('stats.view')}</ComposeText>
              </Button>
            </ListItem.TrailingContent>
          </ListItem>
        </>
      )}
    </SettingsSectionItem>
  );
});
