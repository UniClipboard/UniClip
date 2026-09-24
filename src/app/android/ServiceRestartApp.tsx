/**
 * ServiceRestartApp
 * 极简 RN 根组件，用于后台服务被系统重启后引导 JS 运行时启动。
 * 显示一个短暂的"✓ 服务已恢复"提示，0.5 秒后自动关闭。
 * 注册为 "serviceRestart"（独立于 "main" 入口）。
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, BackHandler, StatusBar } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/stores';
import { initLogger } from '@/support/observability';
import { getAppRuntime } from '@/app/runtime/composition';
import Ionicons from '@expo/vector-icons/Ionicons';
import { buildScheme } from '@/theme/colors';
import { m3Type } from '@/theme/m3Typography';

interface ServiceRestartAppProps {
  systemTheme?: 'light' | 'dark';
}

export default function ServiceRestartApp({ systemTheme }: ServiceRestartAppProps) {
  const { t } = useTranslation('share');
  const { loadConfig, isLoaded } = useSettingsStore();
  const [ready, setReady] = useState(false);
  const isDark = systemTheme === 'dark';

  useEffect(() => {
    initLogger();
  }, []);

  useEffect(() => {
    if (!isLoaded) {
      loadConfig();
    }
  }, [isLoaded, loadConfig]);

  // 启动所有后台服务（和主界面一致）
  useEffect(() => {
    if (!isLoaded) return;

    getAppRuntime()
      .start()
      .finally(() => setReady(true));
  }, [isLoaded]);

  // 自动关闭：短暂展示"服务已恢复"后退出，后台服务持续运行（JS 运行时由前台服务保持存活）
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      BackHandler.exitApp();
    }, 500);
    return () => clearTimeout(timer);
  }, [ready]);

  const colors = buildScheme(isDark);

  return (
    <View style={[styles.container, { backgroundColor: colors.backdrop }]}>
      <StatusBar backgroundColor="transparent" translucent barStyle="light-content" />
      {/* M3 dialog 表面:surfaceContainerHigh + 28dp 圆角,色板与主 App 同源(含动态取色) */}
      <View style={[styles.card, { backgroundColor: colors.surfaceHigh }]}>
        <Ionicons name="checkmark-circle" size={24} color={colors.success} />
        <Text style={[styles.text, { color: colors.textPrimary }]}>
          {t('serviceRestart.restored')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
    borderRadius: 28,
    gap: 12,
    elevation: 3,
  },
  text: {
    ...m3Type.titleMedium,
  },
});
