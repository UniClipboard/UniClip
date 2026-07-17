/**
 * 设置页面(Android) — M3 设置中枢(hub)
 *
 * 一级页展示两个方向独立的剪贴板同步开关，其下为三组带图标 + 动态摘要的分类入口
 * (同步/通用/其他)，具体设置全部下沉到 SettingsSub 二级页。方向开关与 iOS 对齐：
 * 自动写入控制远端到本机，自动推送控制本机到服务端。整页仍是单 <Host> +
 * <LazyColumn>,转场结束
 * 后再挂载 Host,避免滑入期间抢占 JS 线程。
 */
import { memo, useEffect, useState } from 'react';
import { View, ActivityIndicator, InteractionManager } from 'react-native';
import {
  Host,
  LazyColumn,
  ListItem,
  HorizontalDivider,
  Icon,
  Switch as ComposeSwitch,
  Text as ComposeText,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import { fillMaxSize, clickable } from '@expo/ui/jetpack-compose/modifiers';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/stores';
import { APP_VERSION } from '@/constants';
import type { ServerConfig } from '@/types/api';
import type { SettingsSubSection } from '@/navigation/AppNavigator';
import { settingsStyles as styles } from './settings/settingsStyles';
import { SettingsToastProvider, useSettingsToast } from './settings/SettingsToastContext';
import { SettingsSectionItem } from './settings/SettingsSectionItem';

// XML 矢量图标(Material Icons 路径),由 @expo/ui Icon 在原生侧解析渲染。
const ICONS: Record<SettingsSubSection | 'chevron', number> = {
  sync: require('../assets/icons/dns.xml'),
  history: require('../assets/icons/history.xml'),
  background: require('../assets/icons/layers.xml'),
  sms: require('../assets/icons/sms.xml'),
  appearance: require('../assets/icons/palette.xml'),
  storage: require('../assets/icons/storage.xml'),
  about: require('../assets/icons/info.xml'),
  developer: require('../assets/icons/code.xml'),
  chevron: require('../assets/icons/chevron_right.xml'),
};

const getServerDisplayName = (config: ServerConfig): string => {
  if (config.name) return config.name;
  try {
    return new URL(config.url).hostname;
  } catch {
    return config.url;
  }
};

/** 分类入口行:图标 + 标题 + 动态摘要 + chevron。 */
interface HubRowProps {
  section: SettingsSubSection;
  label: string;
  summary: string;
  iconTint: string;
  onNavigate: (section: SettingsSubSection) => void;
}

const HubRow = memo(function HubRow({
  section,
  label,
  summary,
  iconTint,
  onNavigate,
}: HubRowProps) {
  return (
    <ListItem modifiers={[clickable(() => onNavigate(section))]}>
      <ListItem.LeadingContent>
        <Icon source={ICONS[section]} size={22} tint={iconTint} />
      </ListItem.LeadingContent>
      <ListItem.HeadlineContent>
        <ComposeText>{label}</ComposeText>
      </ListItem.HeadlineContent>
      <ListItem.SupportingContent>
        <ComposeText>{summary}</ComposeText>
      </ListItem.SupportingContent>
      <ListItem.TrailingContent>
        <Icon source={ICONS.chevron} size={20} tint={iconTint} />
      </ListItem.TrailingContent>
    </ListItem>
  );
});

interface HubGroupProps {
  iconTint: string;
  onNavigate: (section: SettingsSubSection) => void;
}

/** 与 iOS 对齐的双向同步开关：远端写入本机 / 本机推送远端。 */
const ClipboardSyncDirectionGroup = memo(function ClipboardSyncDirectionGroup() {
  const { t } = useTranslation('settings');
  const showMessage = useSettingsToast();
  const autoApplyRemote = useSettingsStore((s) => s.config?.autoApplyRemote ?? true);
  const autoPushLocal = useSettingsStore((s) => s.config?.autoPushLocal ?? true);

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
      title={t('hub.clipboardSync.title')}
      footer={t('hub.clipboardSync.footer')}
    >
      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>{t('hub.clipboardSync.autoApply.title')}</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.SupportingContent>
          <ComposeText>{t('hub.clipboardSync.autoApply.desc')}</ComposeText>
        </ListItem.SupportingContent>
        <ListItem.TrailingContent>
          <ComposeSwitch
            value={autoApplyRemote}
            onCheckedChange={(enabled) => updateDirection({ autoApplyRemote: enabled })}
          />
        </ListItem.TrailingContent>
      </ListItem>

      <HorizontalDivider />

      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>{t('hub.clipboardSync.autoPush.title')}</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.SupportingContent>
          <ComposeText>{t('hub.clipboardSync.autoPush.desc')}</ComposeText>
        </ListItem.SupportingContent>
        <ListItem.TrailingContent>
          <ComposeSwitch
            value={autoPushLocal}
            onCheckedChange={(enabled) => updateDirection({ autoPushLocal: enabled })}
          />
        </ListItem.TrailingContent>
      </ListItem>
    </SettingsSectionItem>
  );
});

/** 「同步」组:服务器与同步 / 历史记录。 */
const SyncHubGroup = memo(function SyncHubGroup({ iconTint, onNavigate }: HubGroupProps) {
  const { t } = useTranslation('settings');
  const serverSummary = useSettingsStore((s) => {
    const c = s.config;
    const servers = c?.servers ?? [];
    if (servers.length === 0) return t('hub.summary.serverNone');
    const active = servers[c?.activeServerIndex ?? -1];
    return active
      ? t('hub.summary.serverActive', {
          name: getServerDisplayName(active),
          count: servers.length,
        })
      : t('hub.summary.serverCount', { count: servers.length });
  });
  const historySummary = useSettingsStore((s) =>
    t('hub.summary.history', { count: s.config?.maxHistoryItems ?? 1000 })
  );

  return (
    <SettingsSectionItem title={t('category.sync')}>
      <HubRow
        section="sync"
        label={t('hub.rows.serverLabel')}
        summary={serverSummary}
        iconTint={iconTint}
        onNavigate={onNavigate}
      />
      <HorizontalDivider />
      <HubRow
        section="history"
        label={t('category.history')}
        summary={historySummary}
        iconTint={iconTint}
        onNavigate={onNavigate}
      />
    </SettingsSectionItem>
  );
});

/** 「通用」组:后台运行 / 短信转发 / 外观 / 存储。 */
const GeneralHubGroup = memo(function GeneralHubGroup({ iconTint, onNavigate }: HubGroupProps) {
  const { t } = useTranslation('settings');
  const { themeMode } = useTheme();
  const backgroundSummary = useSettingsStore((s) => {
    if (s.isTempDisabledBackgroundTasks) return t('hub.summary.backgroundTempDisabled');
    return (s.config?.enableBackgroundTasks ?? false)
      ? t('hub.summary.backgroundOn')
      : t('hub.summary.backgroundOff');
  });
  const smsSummary = useSettingsStore((s) =>
    (s.config?.enableSmsForwarding ?? false) ? t('hub.summary.smsOn') : t('hub.summary.smsOff')
  );
  const appearanceSummary =
    themeMode === 'light'
      ? t('appearance.mode.light')
      : themeMode === 'dark'
        ? t('appearance.mode.dark')
        : t('appearance.mode.system');

  return (
    <SettingsSectionItem title={t('general.sectionTitle')}>
      <HubRow
        section="background"
        label={t('category.background')}
        summary={backgroundSummary}
        iconTint={iconTint}
        onNavigate={onNavigate}
      />
      <HorizontalDivider />
      <HubRow
        section="sms"
        label={t('category.sms')}
        summary={smsSummary}
        iconTint={iconTint}
        onNavigate={onNavigate}
      />
      <HorizontalDivider />
      <HubRow
        section="appearance"
        label={t('appearance.sectionTitle')}
        summary={appearanceSummary}
        iconTint={iconTint}
        onNavigate={onNavigate}
      />
      <HorizontalDivider />
      <HubRow
        section="storage"
        label={t('category.storage')}
        summary={t('hub.summary.storage')}
        iconTint={iconTint}
        onNavigate={onNavigate}
      />
    </SettingsSectionItem>
  );
});

/** 「其他」组:关于 / 开发者选项。 */
const OtherHubGroup = memo(function OtherHubGroup({ iconTint, onNavigate }: HubGroupProps) {
  const { t } = useTranslation('settings');
  return (
    <SettingsSectionItem title={t('category.other')}>
      <HubRow
        section="about"
        label={t('category.about')}
        summary={t('hub.summary.about', { version: APP_VERSION })}
        iconTint={iconTint}
        onNavigate={onNavigate}
      />
      <HorizontalDivider />
      <HubRow
        section="developer"
        label={t('category.developer')}
        summary={t('hub.summary.developer')}
        iconTint={iconTint}
        onNavigate={onNavigate}
      />
    </SettingsSectionItem>
  );
});

const SettingsScreenInner = () => {
  const { theme } = useTheme();
  const navigation = useNavigation<any>();
  // Host 外部也使用同一 seed,避免图标色与 Host 内的 Compose 色板不一致。
  const appColorScheme = theme.isDark ? 'dark' : 'light';
  const colors = useMaterialColors({
    colorScheme: appColorScheme,
    seedColor: theme.colors.accent,
  });
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

  if (!contentReady) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: theme.colors.background }]}
        edges={[]}
      >
        <View style={styles.loadingPlaceholder}>
          <ActivityIndicator size="large" color={theme.colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  const iconTint = colors.onSurfaceVariant;
  const handleNavigate = (section: SettingsSubSection) =>
    navigation.navigate('SettingsSub', { section });

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      edges={[]}
    >
      <Host style={styles.container} colorScheme={appColorScheme} seedColor={theme.colors.accent}>
        <LazyColumn
          modifiers={[fillMaxSize()]}
          contentPadding={{ start: 16, end: 16, top: 8, bottom: 40 }}
          verticalArrangement={{ spacedBy: 16 }}
        >
          <ClipboardSyncDirectionGroup />
          <SyncHubGroup iconTint={iconTint} onNavigate={handleNavigate} />
          <GeneralHubGroup iconTint={iconTint} onNavigate={handleNavigate} />
          <OtherHubGroup iconTint={iconTint} onNavigate={handleNavigate} />
        </LazyColumn>
      </Host>
    </SafeAreaView>
  );
};

export const SettingsScreen = () => (
  <SettingsToastProvider>
    <SettingsScreenInner />
  </SettingsToastProvider>
);
