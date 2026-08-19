/**
 * 调试 section
 *
 * 含 4 个调试开关，以及仅由调试触发的「短信测试」「统计信息」两个底部表单与结果弹窗。
 * 作为 item:无独立 Host,这些 modal/dialog 作为 item 内 overlay 渲染（见 SettingsSectionItem.dialogs），
 * 其状态/handler 一并内聚到本组件。
 */
import React, { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Column,
  Row,
  ListItem,
  Switch as ComposeSwitch,
  Button,
  TextButton,
  ModalBottomSheet,
  Spacer,
  HorizontalDivider,
  Text as ComposeText,
} from '@expo/ui/jetpack-compose';
import {
  clickable,
  fillMaxWidth,
  width as widthModifier,
  paddingAll,
  height as heightModifier,
  verticalScroll,
} from '@expo/ui/jetpack-compose/modifiers';
import {
  DEVICE_TRUST_PREVIEW_SCENARIOS,
  type DeviceTrustPreviewScenarioId,
} from '@/devtools/deviceTrustPreviewSession';
import {
  isDeviceTrustPreviewAvailable,
  openDeviceTrustPreview,
} from '@/devtools/deviceTrustPreviewCoordinator';
import { useSettingsStore } from '@/stores';
import { useSettingsToast } from '../SettingsToastContext';
import { SettingsSectionItem } from '../SettingsSectionItem';

const TITLE_STYLE = { typography: 'titleLarge' } as const;

export const DebugSection = memo(function DebugSection() {
  const { t } = useTranslation('settingsAbout');
  const showMessage = useSettingsToast();

  const debugMode = useSettingsStore((s) => s.config?.debugMode ?? false);
  const debugOverlayVisible = useSettingsStore((s) => s.config?.debugOverlayVisible ?? false);
  const debugUrlScheme = useSettingsStore((s) => s.config?.debugUrlScheme ?? false);
  const debugUpdateCheckNoLimit = useSettingsStore(
    (s) => s.config?.debugUpdateCheckNoLimit ?? false
  );

  const [showStatsModal, setShowStatsModal] = useState(false);
  const [showDeviceTrustPreviewPicker, setShowDeviceTrustPreviewPicker] = useState(false);
  const [statsText, setStatsText] = useState('');
  const deviceTrustPreviewAvailable = isDeviceTrustPreviewAvailable();

  const openDeviceTrustPreviewPicker = () => setShowDeviceTrustPreviewPicker(true);

  const handleOpenDeviceTrustPreview = (scenario: DeviceTrustPreviewScenarioId) => {
    if (!openDeviceTrustPreview(scenario)) {
      showMessage(t('debug.deviceTrustPreview.unavailable'), 'error');
      return;
    }
    setShowDeviceTrustPreviewPicker(false);
  };

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
          {/* 统计信息底部表单 */}
          {showStatsModal && (
            <ModalBottomSheet onDismissRequest={() => setShowStatsModal(false)}>
              <Column modifiers={[paddingAll(24), fillMaxWidth()]}>
                <ComposeText style={TITLE_STYLE}>{t('stats.title')}</ComposeText>
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
          {showDeviceTrustPreviewPicker && (
            <ModalBottomSheet
              onDismissRequest={() => setShowDeviceTrustPreviewPicker(false)}
              properties={{ shouldDismissOnBackPress: true, shouldDismissOnClickOutside: true }}
            >
              <Column modifiers={[fillMaxWidth(), verticalScroll(), paddingAll(12)]}>
                <ComposeText style={TITLE_STYLE}>
                  {t('debug.deviceTrustPreview.pickerTitle')}
                </ComposeText>
                <Spacer modifiers={[heightModifier(8)]} />
                <ComposeText>{t('debug.deviceTrustPreview.pickerDescription')}</ComposeText>
                <Spacer modifiers={[heightModifier(12)]} />
                {DEVICE_TRUST_PREVIEW_SCENARIOS.map((scenario) => (
                  <ListItem
                    key={scenario.id}
                    modifiers={[
                      clickable(() => handleOpenDeviceTrustPreview(scenario.id)),
                      fillMaxWidth(),
                    ]}
                  >
                    <ListItem.HeadlineContent>
                      <ComposeText>{t(scenario.labelKey)}</ComposeText>
                    </ListItem.HeadlineContent>
                  </ListItem>
                ))}
              </Column>
            </ModalBottomSheet>
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

      {deviceTrustPreviewAvailable ? (
        <>
          <HorizontalDivider />
          <ListItem modifiers={[clickable(openDeviceTrustPreviewPicker)]}>
            <ListItem.HeadlineContent>
              <ComposeText>{t('debug.deviceTrustPreview.label')}</ComposeText>
            </ListItem.HeadlineContent>
            <ListItem.SupportingContent>
              <ComposeText>{t('debug.deviceTrustPreview.description')}</ComposeText>
            </ListItem.SupportingContent>
          </ListItem>
        </>
      ) : null}

      {debugMode && (
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
