/**
 * 设置页面(Android)
 *
 * 整页收敛为单个 <Host> + <LazyColumn>:一级核心 section(服务器/同步/历史/后台/外观)直接
 * 展示,低频/专业设置下沉到二级页(SettingsSub 路由,入口在「更多」分组)。各 section 是无
 * Host 的 item 组件、弹窗内部化。服务器配置/扫码的 RN <Modal> 在 LazyColumn 之外渲染
 * (ServerModals)。转场结束后再挂载 Host,避免滑入期间抢占 JS 线程。
 */
import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, InteractionManager } from 'react-native';
import {
  Host,
  LazyColumn,
  ListItem,
  HorizontalDivider,
  Text as ComposeText,
} from '@expo/ui/jetpack-compose';
import { fillMaxSize, clickable } from '@expo/ui/jetpack-compose/modifiers';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/stores';
import { settingsStyles as styles } from './settings/settingsStyles';
import { SettingsToastProvider } from './settings/SettingsToastContext';
import { SettingsSectionItem } from './settings/SettingsSectionItem';
import { ServerSection } from './settings/ServerSection';
import { ServerModals } from './settings/ServerModals';
import { SyncSettingsSection } from './settings/SyncSettingsSection';
import { HistorySection } from './settings/HistorySection';
import { BackgroundSection } from './settings/BackgroundSection';
import { AppearanceSection } from './settings/AppearanceSection';

// 下沉到二级页的入口(顺序即展示顺序)。
const SUB_ENTRIES = [
  { section: 'sms', label: '短信转发' },
  { section: 'storage', label: '存储' },
  { section: 'about', label: '关于' },
  { section: 'developer', label: '开发者选项' },
] as const;

const SettingsScreenInner = () => {
  const { theme } = useTheme();
  const navigation = useNavigation<any>();
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
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      edges={[]}
    >
      <Host style={styles.container}>
        <LazyColumn
          modifiers={[fillMaxSize()]}
          contentPadding={{ start: 16, end: 16, top: 8, bottom: 40 }}
          verticalArrangement={{ spacedBy: 16 }}
        >
          {/* —— 一级核心 section —— */}
          <ServerSection />
          <SyncSettingsSection />
          <HistorySection />
          <BackgroundSection />
          <AppearanceSection />

          {/* —— 二级页入口 —— */}
          <SettingsSectionItem title="更多">
            {SUB_ENTRIES.map((entry, i) => (
              <React.Fragment key={entry.section}>
                {i > 0 && <HorizontalDivider />}
                <ListItem
                  modifiers={[
                    clickable(() => navigation.navigate('SettingsSub', { section: entry.section })),
                  ]}
                >
                  <ListItem.HeadlineContent>
                    <ComposeText>{entry.label}</ComposeText>
                  </ListItem.HeadlineContent>
                  <ListItem.TrailingContent>
                    <ComposeText>›</ComposeText>
                  </ListItem.TrailingContent>
                </ListItem>
              </React.Fragment>
            ))}
          </SettingsSectionItem>
        </LazyColumn>
      </Host>

      {/* 服务器配置/扫码 RN Modal:必须在 LazyColumn 之外渲染 */}
      <ServerModals />
    </SafeAreaView>
  );
};

export const SettingsScreen = () => (
  <SettingsToastProvider>
    <SettingsScreenInner />
  </SettingsToastProvider>
);
