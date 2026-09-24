/**
 * 调试 section
 *
 * 两组 grouped 列表:「调试」(调试模式及其开启后才出现的开关、统计信息)与「预览」
 * (各类界面预览入口),以及仅由调试触发的统计信息与预览场景选择底部表单。
 * 作为 item:无独立 Host,这些 modal/dialog 作为 item 内 overlay 渲染（见 SettingsSectionItem.dialogs），
 * 其状态/handler 一并内聚到本组件。
 */
import React, { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Column,
  Row,
  ListItem,
  Button,
  TextButton,
  ModalBottomSheet,
  Spacer,
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
import type { AddSyncConnectionPreviewScenarioId } from '@/components/AddSyncConnectionSheet.types';
import { ADD_SYNC_CONNECTION_PREVIEW_SCENARIOS } from '@/devtools/useAddSyncConnectionPreviewFlow';
import {
  isDeviceTrustPreviewAvailable,
  openDeviceTrustPreview,
} from '@/devtools/deviceTrustPreviewCoordinator';
import { useSettingsStore } from '@/stores';
import { useSettingsToast } from '../SettingsToastContext';
import { SettingsSectionItem } from '../SettingsSectionItem';
import { SettingsListRow } from './SettingsListRow';
import { SettingsSwitchRow } from './SettingsSwitchRow';

const TITLE_STYLE = { typography: 'titleLarge' } as const;

interface DebugSectionProps {
  onOpenOnboardingPreview: () => void;
  onOpenConnectionPreview: () => void;
  onOpenConnectionSheetPreview: (
    scenario: AddSyncConnectionPreviewScenarioId
  ) => void;
}

export const DebugSection = memo(function DebugSection({
  onOpenOnboardingPreview,
  onOpenConnectionPreview,
  onOpenConnectionSheetPreview,
}: DebugSectionProps) {
  const { t } = useTranslation('settingsAbout');
  const showMessage = useSettingsToast();

  const debugMode = useSettingsStore((s) => s.config?.debugMode ?? false);
  const debugOverlayVisible = useSettingsStore(
    (s) => s.config?.debugOverlayVisible ?? false
  );
  const debugUrlScheme = useSettingsStore(
    (s) => s.config?.debugUrlScheme ?? false
  );
  const debugUpdateCheckNoLimit = useSettingsStore(
    (s) => s.config?.debugUpdateCheckNoLimit ?? false
  );

  const [showStatsModal, setShowStatsModal] = useState(false);
  const [showDeviceTrustPreviewPicker, setShowDeviceTrustPreviewPicker] =
    useState(false);
  const [
    showConnectionSheetPreviewPicker,
    setShowConnectionSheetPreviewPicker,
  ] = useState(false);
  const [statsText, setStatsText] = useState('');
  const deviceTrustPreviewAvailable = isDeviceTrustPreviewAvailable();

  const openDeviceTrustPreviewPicker = () =>
    setShowDeviceTrustPreviewPicker(true);

  const handleOpenDeviceTrustPreview = (
    scenario: DeviceTrustPreviewScenarioId
  ) => {
    if (!openDeviceTrustPreview(scenario)) {
      showMessage(t('debug.deviceTrustPreview.unavailable'), 'error');
      return;
    }
    setShowDeviceTrustPreviewPicker(false);
  };

  const handleToggleDebugMode = async (enabled: boolean) => {
    try {
      await useSettingsStore.getState().updateConfig({ debugMode: enabled });
      showMessage(
        enabled ? t('debug.modeEnabled') : t('debug.modeDisabled'),
        'success'
      );
    } catch (error: unknown) {
      showMessage(
        error instanceof Error ? error.message : t('error.saveFailed'),
        'error'
      );
    }
  };

  const handleToggleDebugOverlayVisible = async (enabled: boolean) => {
    try {
      await useSettingsStore
        .getState()
        .updateConfig({ debugOverlayVisible: enabled });
      showMessage(
        enabled
          ? t('debug.overlayVisibleToast')
          : t('debug.overlayHiddenToast'),
        'success'
      );
    } catch (error: unknown) {
      showMessage(
        error instanceof Error ? error.message : t('error.saveFailed'),
        'error'
      );
    }
  };

  const handleToggleDebugUrlScheme = async (enabled: boolean) => {
    try {
      await useSettingsStore
        .getState()
        .updateConfig({ debugUrlScheme: enabled });
    } catch (error: unknown) {
      showMessage(
        error instanceof Error ? error.message : t('error.saveFailed'),
        'error'
      );
    }
  };

  const handleToggleDebugUpdateCheckNoLimit = async (enabled: boolean) => {
    try {
      await useSettingsStore
        .getState()
        .updateConfig({ debugUpdateCheckNoLimit: enabled });
    } catch (error: unknown) {
      showMessage(
        error instanceof Error ? error.message : t('error.saveFailed'),
        'error'
      );
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
    <Column modifiers={[fillMaxWidth()]}>
      <SettingsSectionItem
        variant="grouped"
        title={t('debug.title')}
        dialogs={
          <>
            {/* 统计信息底部表单 */}
            {showStatsModal && (
              <ModalBottomSheet
                onDismissRequest={() => setShowStatsModal(false)}
              >
                <Column modifiers={[paddingAll(24), fillMaxWidth()]}>
                  <ComposeText style={TITLE_STYLE}>
                    {t('stats.title')}
                  </ComposeText>
                  <Spacer modifiers={[heightModifier(16)]} />
                  <ComposeText>{statsText}</ComposeText>
                  <Spacer modifiers={[heightModifier(16)]} />
                  <Row modifiers={[fillMaxWidth()]} horizontalArrangement="end">
                    <TextButton onClick={() => setShowStatsModal(false)}>
                      <ComposeText>
                        {t('action.close', { ns: 'common' })}
                      </ComposeText>
                    </TextButton>
                    <Spacer modifiers={[widthModifier(8)]} />
                    <Button onClick={handleCopyStatistics}>
                      <ComposeText>
                        {t('action.copy', { ns: 'common' })}
                      </ComposeText>
                    </Button>
                  </Row>
                </Column>
              </ModalBottomSheet>
            )}
            {showDeviceTrustPreviewPicker && (
              <ModalBottomSheet
                onDismissRequest={() => setShowDeviceTrustPreviewPicker(false)}
                properties={{
                  shouldDismissOnBackPress: true,
                  shouldDismissOnClickOutside: true,
                }}
              >
                <Column
                  modifiers={[fillMaxWidth(), verticalScroll(), paddingAll(12)]}
                >
                  <ComposeText style={TITLE_STYLE}>
                    {t('debug.deviceTrustPreview.pickerTitle')}
                  </ComposeText>
                  <Spacer modifiers={[heightModifier(8)]} />
                  <ComposeText>
                    {t('debug.deviceTrustPreview.pickerDescription')}
                  </ComposeText>
                  <Spacer modifiers={[heightModifier(12)]} />
                  {DEVICE_TRUST_PREVIEW_SCENARIOS.map((scenario) => (
                    <ListItem
                      key={scenario.id}
                      modifiers={[
                        clickable(() =>
                          handleOpenDeviceTrustPreview(scenario.id)
                        ),
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
            {showConnectionSheetPreviewPicker && (
              <ModalBottomSheet
                onDismissRequest={() =>
                  setShowConnectionSheetPreviewPicker(false)
                }
                properties={{
                  shouldDismissOnBackPress: true,
                  shouldDismissOnClickOutside: true,
                }}
              >
                <Column
                  modifiers={[fillMaxWidth(), verticalScroll(), paddingAll(12)]}
                >
                  <ComposeText style={TITLE_STYLE}>
                    {t('debug.connectionSheetPreview.pickerTitle')}
                  </ComposeText>
                  <Spacer modifiers={[heightModifier(8)]} />
                  <ComposeText>
                    {t('debug.connectionSheetPreview.pickerDescription')}
                  </ComposeText>
                  <Spacer modifiers={[heightModifier(12)]} />
                  {ADD_SYNC_CONNECTION_PREVIEW_SCENARIOS.map((scenario) => (
                    <ListItem
                      key={scenario.id}
                      modifiers={[
                        clickable(() => {
                          setShowConnectionSheetPreviewPicker(false);
                          onOpenConnectionSheetPreview(scenario.id);
                        }),
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
        <SettingsSwitchRow
          key="debugMode"
          title={t('debug.modeLabel')}
          value={debugMode}
          onValueChange={(enabled) => void handleToggleDebugMode(enabled)}
        />
        {debugMode ? (
          <>
            <SettingsSwitchRow
              key="overlay"
              title={t('debug.overlayLabel')}
              description={t('debug.overlayDesc')}
              value={debugOverlayVisible}
              onValueChange={(enabled) =>
                void handleToggleDebugOverlayVisible(enabled)
              }
            />
            <SettingsSwitchRow
              key="urlScheme"
              title={t('debug.urlSchemeLabel')}
              value={debugUrlScheme}
              onValueChange={(enabled) =>
                void handleToggleDebugUrlScheme(enabled)
              }
            />
            <SettingsSwitchRow
              key="updateNoLimit"
              title={t('debug.updateNoLimitLabel')}
              description={t('debug.updateNoLimitDesc')}
              value={debugUpdateCheckNoLimit}
              onValueChange={(enabled) =>
                void handleToggleDebugUpdateCheckNoLimit(enabled)
              }
            />
            <SettingsListRow
              key="statistics"
              title={t('stats.title')}
              trailing={{ action: t('stats.view') }}
              onPress={() => void handleShowStatistics()}
            />
          </>
        ) : null}
      </SettingsSectionItem>

      <Spacer modifiers={[heightModifier(24)]} />
      <SettingsSectionItem variant="grouped" title={t('debug.previewsTitle')}>
        {deviceTrustPreviewAvailable ? (
          <>
            <SettingsListRow
              key="deviceTrustPreview"
              title={t('debug.deviceTrustPreview.label')}
              description={t('debug.deviceTrustPreview.description')}
              onPress={openDeviceTrustPreviewPicker}
            />
            <SettingsListRow
              key="connectionSheetPreview"
              title={t('debug.connectionSheetPreview.label')}
              description={t('debug.connectionSheetPreview.description')}
              onPress={() => setShowConnectionSheetPreviewPicker(true)}
            />
          </>
        ) : null}
        <SettingsListRow
          key="onboardingPreview"
          title={t('debug.onboardingPreview')}
          trailing="chevron"
          onPress={onOpenOnboardingPreview}
        />
        <SettingsListRow
          key="connectionPreview"
          title={t('debug.connectionPreview')}
          trailing="chevron"
          onPress={onOpenConnectionPreview}
        />
      </SettingsSectionItem>
    </Column>
  );
});
