/**
 * 设置页面(Android) — M3 设置中枢(hub)
 *
 * 一级页只做总开关与导航:顶部「自动同步」主开关卡片(M3 primary-switch 模式,开启时
 * primaryContainer 高亮),其下为三组带图标 + 动态摘要的分类入口(同步/通用/其他),
 * 具体设置全部下沉到 SettingsSub 二级页。整页仍是单 <Host> + <LazyColumn>,转场结束
 * 后再挂载 Host,避免滑入期间抢占 JS 线程。
 */
import React, { memo, useEffect, useState } from 'react';
import { View, ActivityIndicator, InteractionManager } from 'react-native';
import {
  Host,
  LazyColumn,
  ListItem,
  HorizontalDivider,
  Card,
  Column,
  Row,
  Spacer,
  Icon,
  Switch as ComposeSwitch,
  Text as ComposeText,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import {
  fillMaxSize,
  fillMaxWidth,
  clickable,
  padding,
  weight,
  height as heightModifier,
} from '@expo/ui/jetpack-compose/modifiers';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
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

/** 顶部「自动同步」主开关卡片(M3 primary switch)。 */
const AutoSyncMasterCard = memo(function AutoSyncMasterCard() {
  const showMessage = useSettingsToast();
  // 无参调用读取所在 <Host> 的主题色板,跟随 Host 的 colorScheme
  const colors = useMaterialColors();
  const autoSyncEnabled = useSettingsStore((s) => s.config?.autoPushLocal ?? false);

  const handleToggle = async (enabled: boolean) => {
    try {
      await useSettingsStore.getState().setAutoSync(enabled);
      showMessage(enabled ? '已启用自动同步' : '已禁用自动同步', 'success');
    } catch (error: unknown) {
      // 失败时 store 已回滚 config,Switch 会自动回弹
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  return (
    <Card
      colors={
        autoSyncEnabled
          ? { containerColor: colors.primaryContainer, contentColor: colors.onPrimaryContainer }
          : { containerColor: colors.surface }
      }
      border={{ width: 1, color: colors.outlineVariant }}
    >
      <Row
        verticalAlignment="center"
        modifiers={[
          fillMaxWidth(),
          clickable(() => handleToggle(!autoSyncEnabled)),
          padding(20, 18, 16, 18),
        ]}
      >
        <Column modifiers={[weight(1)]}>
          <ComposeText style={{ typography: 'titleMedium' }}>自动同步</ComposeText>
          <Spacer modifiers={[heightModifier(2)]} />
          <ComposeText
            style={{ fontSize: 13 }}
            color={autoSyncEnabled ? colors.onPrimaryContainer : colors.onSurfaceVariant}
          >
            处于前台时自动同步剪贴板
          </ComposeText>
        </Column>
        <ComposeSwitch value={autoSyncEnabled} onCheckedChange={handleToggle} />
      </Row>
    </Card>
  );
});

/** 「同步」组:服务器与同步 / 历史记录。 */
const SyncHubGroup = memo(function SyncHubGroup({ iconTint, onNavigate }: HubGroupProps) {
  const serverSummary = useSettingsStore((s) => {
    const c = s.config;
    const servers = c?.servers ?? [];
    if (servers.length === 0) return '未配置服务器';
    const active = servers[c?.activeServerIndex ?? -1];
    return active
      ? `当前:${getServerDisplayName(active)} · 共 ${servers.length} 台`
      : `共 ${servers.length} 台服务器`;
  });
  const historySummary = useSettingsStore((s) => {
    const c = s.config;
    const i = c?.activeServerIndex ?? -1;
    const supportsSync = i >= 0 && c?.servers?.[i]?.type === 'syncclipboard';
    const syncOn = (c?.enableHistorySync ?? false) && supportsSync;
    return `${syncOn ? '同步已开启' : '同步已关闭'} · 最多保留 ${c?.maxHistoryItems ?? 1000} 条`;
  });

  return (
    <SettingsSectionItem title="同步">
      <HubRow
        section="sync"
        label="服务器与同步"
        summary={serverSummary}
        iconTint={iconTint}
        onNavigate={onNavigate}
      />
      <HorizontalDivider />
      <HubRow
        section="history"
        label="历史记录"
        summary={historySummary}
        iconTint={iconTint}
        onNavigate={onNavigate}
      />
    </SettingsSectionItem>
  );
});

/** 「通用」组:后台运行 / 短信转发 / 外观 / 存储。 */
const GeneralHubGroup = memo(function GeneralHubGroup({ iconTint, onNavigate }: HubGroupProps) {
  const { themeMode } = useTheme();
  const backgroundSummary = useSettingsStore((s) => {
    if (s.isTempDisabledBackgroundTasks) return '已临时停止,重启应用后恢复';
    return (s.config?.enableBackgroundTasks ?? false) ? '后台任务已开启' : '后台任务已关闭';
  });
  const smsSummary = useSettingsStore((s) =>
    (s.config?.enableSmsForwarding ?? false) ? '验证码自动上传已开启' : '验证码自动上传已关闭'
  );
  const appearanceSummary =
    themeMode === 'light' ? '浅色' : themeMode === 'dark' ? '深色' : '跟随系统';

  return (
    <SettingsSectionItem title="通用">
      <HubRow
        section="background"
        label="后台运行"
        summary={backgroundSummary}
        iconTint={iconTint}
        onNavigate={onNavigate}
      />
      <HorizontalDivider />
      <HubRow
        section="sms"
        label="短信转发"
        summary={smsSummary}
        iconTint={iconTint}
        onNavigate={onNavigate}
      />
      <HorizontalDivider />
      <HubRow
        section="appearance"
        label="外观"
        summary={appearanceSummary}
        iconTint={iconTint}
        onNavigate={onNavigate}
      />
      <HorizontalDivider />
      <HubRow
        section="storage"
        label="存储"
        summary="缓存、日志与历史记录占用"
        iconTint={iconTint}
        onNavigate={onNavigate}
      />
    </SettingsSectionItem>
  );
});

/** 「其他」组:关于 / 开发者选项。 */
const OtherHubGroup = memo(function OtherHubGroup({ iconTint, onNavigate }: HubGroupProps) {
  return (
    <SettingsSectionItem title="其他">
      <HubRow
        section="about"
        label="关于"
        summary={`当前版本 ${APP_VERSION}`}
        iconTint={iconTint}
        onNavigate={onNavigate}
      />
      <HorizontalDivider />
      <HubRow
        section="developer"
        label="开发者选项"
        summary="日志、调试与快捷方式"
        iconTint={iconTint}
        onNavigate={onNavigate}
      />
    </SettingsSectionItem>
  );
});

const SettingsScreenInner = () => {
  const { theme } = useTheme();
  const navigation = useNavigation<any>();
  // 本组件在 <Host> 之外,须显式指定 colorScheme 跟随 app 主题(而非系统深浅色)
  const appColorScheme = theme.isDark ? 'dark' : 'light';
  const colors = useMaterialColors({ colorScheme: appColorScheme });
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
      <Host style={styles.container} colorScheme={appColorScheme}>
        <LazyColumn
          modifiers={[fillMaxSize()]}
          contentPadding={{ start: 16, end: 16, top: 8, bottom: 40 }}
          verticalArrangement={{ spacedBy: 16 }}
        >
          <AutoSyncMasterCard />
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
