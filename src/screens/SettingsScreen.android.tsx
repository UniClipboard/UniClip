/**
 * 设置页面(Android) — M3 设置中枢(hub)
 *
 * 底部导航「设置」目的地。M3 Expressive 分组列表:最上方是两个方向独立的剪贴板同步开关,
 * 其下为「通用 / 支持 / 其他」三组带图标 + 动态摘要的入口,具体设置全部下沉到 SettingsSub
 * 二级页。同步通道与空间设备已升为顶级「设备」目的地,不在此重复入口。方向开关与 iOS 对齐:
 * 自动写入控制远端到本机,自动推送控制本机到服务端。整页仍是单 <Host> + <LazyColumn>,
 * 转场结束后再挂载 Host,避免滑入期间抢占 JS 线程。
 */
import { memo, useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';
import { Host, LazyColumn } from '@expo/ui/jetpack-compose';
import { fillMaxSize } from '@expo/ui/jetpack-compose/modifiers';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useFloatingNavigationClearance,
  useFloatingNavigationSnackbarOffset,
} from '@/components/android/floatingNavigationClearance';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/stores';
import { APP_VERSION } from '@/constants';
import type { SettingsSubSection } from '@/navigation/AppNavigator';
import { settingsStyles as styles } from './settings/settingsStyles';
import { SettingsToastProvider, useSettingsToast } from './settings/SettingsToastContext';
import { SettingsSectionItem } from './settings/SettingsSectionItem';
import { SettingsLeadingIcon } from './settings/android/SettingsLeadingIcon';
import { SettingsListRow } from './settings/android/SettingsListRow';
import { SettingsSwitchRow } from './settings/android/SettingsSwitchRow';
import { MATERIAL_SEED_COLOR } from '@/theme/colors';

// XML 矢量图标(Material Icons 路径),由 @expo/ui Icon 在原生侧解析渲染。
const ICONS = {
  autoApply: require('../assets/icons/file_download.xml'),
  autoPush: require('../assets/icons/file_upload.xml'),
  history: require('../assets/icons/history.xml'),
  background: require('../assets/icons/layers.xml'),
  appearance: require('../assets/icons/palette.xml'),
  storage: require('../assets/icons/storage.xml'),
  diagnostics: require('../assets/icons/description.xml'),
  privacy: require('../assets/icons/privacy_tip.xml'),
  about: require('../assets/icons/info.xml'),
  developer: require('../assets/icons/code.xml'),
} satisfies Partial<Record<SettingsSubSection | 'autoApply' | 'autoPush', number>>;

type HubSection = Exclude<
  SettingsSubSection,
  'syncChannel' | 'space' | 'spaceSettings' | 'lanServers'
>;

/** 分类入口行:图标 + 标题 + 动态摘要 + chevron,整行可点(testID 供 Maestro 定位)。 */
interface HubRowProps {
  section: HubSection;
  label: string;
  summary: string;
  muted?: boolean;
  onNavigate: (section: SettingsSubSection) => void;
}

const HubRow = memo(function HubRow({ section, label, summary, muted, onNavigate }: HubRowProps) {
  return (
    <SettingsListRow
      testID={`settings-${section}`}
      title={label}
      description={summary}
      icon={ICONS[section]}
      iconTone={muted ? 'muted' : 'primary'}
      trailing="chevron"
      onPress={() => onNavigate(section)}
    />
  );
});

interface HubGroupProps {
  onNavigate: (section: SettingsSubSection) => void;
}

/** 与 iOS 对齐的双向同步开关：远端写入本机 / 本机推送远端。 */
const ClipboardSyncDirectionGroup = memo(function ClipboardSyncDirectionGroup() {
  const { t } = useTranslation('settings');
  const showMessage = useSettingsToast();
  const syncChannel = useSettingsStore((s) => s.config?.syncChannel ?? 'lan');
  const autoApplyRemote = useSettingsStore((s) => s.config?.autoApplyRemote ?? true);
  const autoPushLocal = useSettingsStore((s) => s.config?.autoPushLocal ?? true);
  const autoApplyDescription = t(
    syncChannel === 'p2p'
      ? 'hub.clipboardSync.autoApply.descP2p'
      : 'hub.clipboardSync.autoApply.descLan'
  );
  const autoPushDescription = t(
    syncChannel === 'p2p'
      ? 'hub.clipboardSync.autoPush.descP2p'
      : 'hub.clipboardSync.autoPush.descLan'
  );

  const updateDirection = async (
    updates: { autoApplyRemote: boolean } | { autoPushLocal: boolean }
  ) => {
    const result = await useSettingsStore.getState().updateConfig(updates);
    if (!result.ok) {
      showMessage(result.error || t('hub.clipboardSync.updateFailed'), 'error');
    }
  };

  return (
    <SettingsSectionItem
      variant="grouped"
      title={t('hub.clipboardSync.title')}
      footer={t('hub.clipboardSync.footer')}
    >
      <SettingsSwitchRow
        key="autoApply"
        title={t('hub.clipboardSync.autoApply.title')}
        description={autoApplyDescription}
        leading={<SettingsLeadingIcon source={ICONS.autoApply} />}
        value={autoApplyRemote}
        onValueChange={(enabled) => void updateDirection({ autoApplyRemote: enabled })}
      />
      <SettingsSwitchRow
        key="autoPush"
        title={t('hub.clipboardSync.autoPush.title')}
        description={autoPushDescription}
        leading={<SettingsLeadingIcon source={ICONS.autoPush} />}
        value={autoPushLocal}
        onValueChange={(enabled) => void updateDirection({ autoPushLocal: enabled })}
      />
    </SettingsSectionItem>
  );
});

/** 「通用」组:历史记录 / 后台运行 / 外观 / 存储。 */
const GeneralHubGroup = memo(function GeneralHubGroup({ onNavigate }: HubGroupProps) {
  const { t } = useTranslation('settings');
  const { themeMode } = useTheme();
  const historySummary = useSettingsStore((s) =>
    t('hub.summary.history', { count: s.config?.maxHistoryItems ?? 1000 })
  );
  const backgroundSummary = useSettingsStore((s) => {
    if (s.isTempDisabledBackgroundTasks) return t('hub.summary.backgroundTempDisabled');
    return s.config?.enableBackgroundTasks ?? false
      ? t('hub.summary.backgroundOn')
      : t('hub.summary.backgroundOff');
  });
  const appearanceSummary =
    themeMode === 'light'
      ? t('appearance.mode.light')
      : themeMode === 'dark'
      ? t('appearance.mode.dark')
      : t('appearance.mode.system');

  return (
    <SettingsSectionItem variant="grouped" title={t('general.sectionTitle')}>
      <HubRow
        key="history"
        section="history"
        label={t('category.history')}
        summary={historySummary}
        onNavigate={onNavigate}
      />
      <HubRow
        key="background"
        section="background"
        label={t('category.background')}
        summary={backgroundSummary}
        onNavigate={onNavigate}
      />
      <HubRow
        key="appearance"
        section="appearance"
        label={t('appearance.sectionTitle')}
        summary={appearanceSummary}
        onNavigate={onNavigate}
      />
      <HubRow
        key="storage"
        section="storage"
        label={t('category.storage')}
        summary={t('hub.summary.storage')}
        onNavigate={onNavigate}
      />
    </SettingsSectionItem>
  );
});

/** 「支持」组:诊断日志——普通用户反馈问题时也要用,不藏在开发者选项里。 */
const SupportHubGroup = memo(function SupportHubGroup({ onNavigate }: HubGroupProps) {
  const { t } = useTranslation('settings');
  return (
    <SettingsSectionItem variant="grouped" title={t('category.support')}>
      <HubRow
        section="diagnostics"
        label={t('category.diagnostics')}
        summary={t('hub.summary.diagnostics')}
        onNavigate={onNavigate}
      />
    </SettingsSectionItem>
  );
});

/** 「其他」组:隐私 / 关于 / 开发者选项。 */
const OtherHubGroup = memo(function OtherHubGroup({ onNavigate }: HubGroupProps) {
  const { t } = useTranslation('settings');
  return (
    <SettingsSectionItem variant="grouped" title={t('category.other')}>
      <HubRow
        key="privacy"
        section="privacy"
        label={t('category.privacy')}
        summary={t('hub.summary.privacy')}
        onNavigate={onNavigate}
      />
      <HubRow
        key="about"
        section="about"
        label={t('category.about')}
        summary={t('hub.summary.about', { version: APP_VERSION })}
        onNavigate={onNavigate}
      />
      <HubRow
        key="developer"
        section="developer"
        label={t('category.developer')}
        summary={t('hub.summary.developer')}
        muted
        onNavigate={onNavigate}
      />
    </SettingsSectionItem>
  );
});

const SettingsScreenInner = () => {
  const { theme } = useTheme();
  // 列表延伸到系统导航栏(及顶级目的地的悬浮导航胶囊)之下,末项需让出这部分
  const insets = useSafeAreaInsets();
  const navClearance = useFloatingNavigationClearance();
  const navigation = useNavigation<any>();
  const appColorScheme = theme.isDark ? 'dark' : 'light';
  const isLoaded = useSettingsStore((s) => s.isLoaded);
  const loadConfig = useSettingsStore((s) => s.loadConfig);

  // 转场结束(runAfterInteractions)后再挂载 Host,避免滑入转场期间抢占 JS 线程导致卡顿。
  const [contentReady, setContentReady] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const task = InteractionManager.runAfterInteractions(() => setContentReady(true));
    return () => task.cancel();
  }, []);

  useEffect(() => {
    if (!isLoaded) loadConfig();
  }, [isLoaded, loadConfig]);

  // 转场期间只铺背景色:挂载等待很短,M3 不为亚秒级等待显示转圈
  if (!contentReady) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: theme.colors.background }]}
        edges={[]}
      />
    );
  }

  const handleNavigate = (section: SettingsSubSection) =>
    navigation.navigate('SettingsSub', { section });

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      edges={[]}
    >
      <Host style={styles.container} colorScheme={appColorScheme} seedColor={MATERIAL_SEED_COLOR}>
        <LazyColumn
          modifiers={[fillMaxSize()]}
          contentPadding={{ start: 16, end: 16, top: 8, bottom: insets.bottom + navClearance + 40 }}
          verticalArrangement={{ spacedBy: 16 }}
        >
          <ClipboardSyncDirectionGroup />
          <GeneralHubGroup onNavigate={handleNavigate} />
          <SupportHubGroup onNavigate={handleNavigate} />
          <OtherHubGroup onNavigate={handleNavigate} />
        </LazyColumn>
      </Host>
    </SafeAreaView>
  );
};

export const SettingsScreen = () => {
  const snackbarOffset = useFloatingNavigationSnackbarOffset();
  return (
    <SettingsToastProvider bottomOffset={snackbarOffset}>
      <SettingsScreenInner />
    </SettingsToastProvider>
  );
};
