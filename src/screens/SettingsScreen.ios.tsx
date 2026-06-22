import React, { useState, useEffect, useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import {
  Host,
  BottomSheet,
  Group,
  Form,
  Section,
  Toggle,
  Picker,
  Label,
  LabeledContent,
  Button as SwiftUIButton,
  Link,
  Text as SwiftUIText,
  HStack,
  VStack,
  Spacer,
} from '@expo/ui/swift-ui';
import {
  presentationDetents,
  presentationDragIndicator,
  listStyle,
  pickerStyle,
  tag,
  foregroundStyle,
  foregroundColor,
  monospacedDigit,
  buttonStyle,
  disabled as disabledMod,
  frame,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import { iosAccentColor } from '@/theme/iosDesignTokens';
import { SheetHeader } from '@/components/ui';
import { useSettingsStore } from '@/stores';
import { useTheme } from '@/hooks/useTheme';
import { APP_VERSION } from '@/constants';
import { calculateDirectorySize, clearDirectory, CLIPBOARD_TEMP_DIR } from '@/utils/fileStorage';
import type { ThemeMode } from '@/theme';

const CACHE_CAP_OPTIONS = [
  { label: '50 MB', value: 50 * 1024 * 1024 },
  { label: '200 MB', value: 200 * 1024 * 1024 },
  { label: '500 MB', value: 500 * 1024 * 1024 },
  { label: '1000 MB', value: 1000 * 1024 * 1024 },
];

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export const SettingsScreen = () => {
  const navigation = useNavigation();
  const { config, isLoaded, loadConfig, updateConfig } = useSettingsStore();
  const { setThemeMode } = useTheme();

  const [presented, setPresented] = useState(true);
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [purging, setPurging] = useState(false);

  useEffect(() => {
    if (!isLoaded) loadConfig();
  }, [isLoaded, loadConfig]);

  useEffect(() => {
    refreshCacheSize();
  }, []);

  const refreshCacheSize = useCallback(async () => {
    try {
      const size = calculateDirectorySize(CLIPBOARD_TEMP_DIR);
      setCacheSize(size);
    } catch {
      setCacheSize(0);
    }
  }, []);

  const handlePurgeCache = useCallback(async () => {
    setPurging(true);
    try {
      clearDirectory(CLIPBOARD_TEMP_DIR);
      await refreshCacheSize();
    } catch {
      // ignore
    } finally {
      setPurging(false);
    }
  }, [refreshCacheSize]);

  const handleDismiss = useCallback(
    (p: boolean) => {
      if (!p) {
        setPresented(false);
        navigation.goBack();
      }
    },
    [navigation]
  );

  if (!isLoaded || !config) return null;

  const servers = config.servers ?? [];

  const prefetchEnabled = config.attachmentAutoDownload !== 'off';
  const prefetchOnCellular = config.attachmentAutoDownload === 'always';

  const handlePrefetchToggle = (enabled: boolean) => {
    updateConfig({ attachmentAutoDownload: enabled ? 'wifi' : 'off' });
  };

  const handlePrefetchCellularToggle = (enabled: boolean) => {
    updateConfig({ attachmentAutoDownload: enabled ? 'always' : 'wifi' });
  };

  const cacheSizeLabel = purging
    ? '清除中…'
    : cacheSize !== null
      ? formatSize(cacheSize)
      : '—';

  return (
    <Host style={{ position: 'absolute', bottom: 0, left: 0, width: 1, height: 1 }}>
      <BottomSheet isPresented={presented} onIsPresentedChange={handleDismiss}>
        <Group
          modifiers={[
            presentationDetents(['large']),
            presentationDragIndicator('visible'),
          ]}
        >
          <VStack modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), ...(iosAccentColor ? [tint(iosAccentColor)] : [])]}>
            <SheetHeader title="设置" />

            <Form modifiers={[listStyle('insetGrouped')]}>
              {/* ── 同步 ── */}
              <Section
                header={<SwiftUIText>同步</SwiftUIText>}
                footer={
                  <SwiftUIText>
                    「允许不安全证书」仅在服务器使用自签名 HTTPS 证书时需要，纯 HTTP 无需开启。
                  </SwiftUIText>
                }
              >
                <LabeledContent
                  label={<Label title="服务器列表" systemImage="server.rack" />}
                >
                  <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                    {servers.length} 个
                  </SwiftUIText>
                </LabeledContent>

                <Toggle
                  label="允许不安全证书"
                  systemImage="lock.open"
                  isOn={config.trustInsecureCert}
                  onIsOnChange={(v) => updateConfig({ trustInsecureCert: v })}
                />
              </Section>

              {/* ── 行为 ── */}
              <Section
                header={<SwiftUIText>行为</SwiftUIText>}
                footer={
                  <SwiftUIText>
                    开启后，服务器有新内容时会立即覆盖本机剪贴板；关闭则只在主页高亮提示，不修改剪贴板。
                  </SwiftUIText>
                }
              >
                <Toggle
                  label="自动写入本机剪贴板"
                  systemImage="doc.on.clipboard"
                  isOn={config.autoApplyRemote}
                  onIsOnChange={(v) => updateConfig({ autoApplyRemote: v })}
                />
              </Section>

              <Section
                footer={
                  <SwiftUIText>
                    关闭（推荐）：在主页用「粘贴」按钮一键推送，iOS
                    不会弹窗。开启后会自动读取并推送本机复制的内容——iOS
                    在读取其他 App 复制的内容时会弹出「允许粘贴」确认。
                  </SwiftUIText>
                }
              >
                <Toggle
                  label="自动推送本机剪贴板"
                  systemImage="arrow.up.doc"
                  isOn={config.autoPushLocal}
                  onIsOnChange={(v) => updateConfig({ autoPushLocal: v })}
                />
              </Section>

              {/* ── 更新和下载 ── */}
              <Section>
                <Toggle
                  label="启动时检查更新"
                  systemImage="arrow.triangle.2.circlepath"
                  isOn={config.autoCheckUpdate}
                  onIsOnChange={(v) => updateConfig({ autoCheckUpdate: v })}
                />
              </Section>

              {/* ── 存储 ── */}
              <Section
                header={<SwiftUIText>存储</SwiftUIText>}
                footer={
                  <SwiftUIText>
                    开启预下载后，新内容会在后台静默缓存，点击预览无需等待。
                  </SwiftUIText>
                }
              >
                <Toggle
                  label="预下载附件"
                  systemImage="icloud.and.arrow.down"
                  isOn={prefetchEnabled}
                  onIsOnChange={handlePrefetchToggle}
                />

                {prefetchEnabled && (
                  <Toggle
                    label="蜂窝下也预下载"
                    systemImage="antenna.radiowaves.left.and.right"
                    isOn={prefetchOnCellular}
                    onIsOnChange={handlePrefetchCellularToggle}
                  />
                )}

                <Picker
                  label="缓存上限"
                  systemImage="externaldrive"
                  selection={config.payloadCacheMaxBytes}
                  onSelectionChange={(v) =>
                    updateConfig({ payloadCacheMaxBytes: v as number })
                  }
                  modifiers={[pickerStyle('menu')]}
                >
                  {CACHE_CAP_OPTIONS.map((opt) => (
                    <SwiftUIText key={opt.value} modifiers={[tag(opt.value)]}>
                      {opt.label}
                    </SwiftUIText>
                  ))}
                </Picker>

                <HStack>
                  <Label title="缓存占用" systemImage="internaldrive" />
                  <Spacer />
                  <SwiftUIText modifiers={[foregroundStyle('secondary'), monospacedDigit()]}>
                    {cacheSizeLabel}
                  </SwiftUIText>
                  <Spacer modifiers={[frame({ width: 8 })]} />
                  <SwiftUIButton
                    label="清除"
                    onPress={handlePurgeCache}
                    modifiers={[
                      buttonStyle('borderless'),
                      foregroundColor('red'),
                      disabledMod(purging || (cacheSize ?? 0) === 0),
                    ]}
                  />
                </HStack>
              </Section>

              {/* ── 外观 ── */}
              <Section header={<SwiftUIText>外观</SwiftUIText>}>
                <Picker
                  label="主题"
                  systemImage="circle.lefthalf.filled"
                  selection={config.appearance}
                  onSelectionChange={(v) => {
                    const appearance = v as 'system' | 'light' | 'dark';
                    updateConfig({ appearance });
                    const modeMap: Record<string, ThemeMode> = { system: 'auto', light: 'light', dark: 'dark' };
                    setThemeMode(modeMap[appearance] ?? 'auto');
                  }}
                  modifiers={[pickerStyle('menu')]}
                >
                  <SwiftUIText modifiers={[tag('system')]}>跟随系统</SwiftUIText>
                  <SwiftUIText modifiers={[tag('light')]}>浅色</SwiftUIText>
                  <SwiftUIText modifiers={[tag('dark')]}>深色</SwiftUIText>
                </Picker>
              </Section>

              {/* ── 诊断 ── */}
              <Section title="诊断">
                <Link destination="https://github.com/UniClipboard/UniClipboard">
                  <Label title="项目主页" systemImage="globe" />
                </Link>

                <LabeledContent
                  label={<Label title="版本" systemImage="info.circle" />}
                >
                  <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                    {APP_VERSION}
                  </SwiftUIText>
                </LabeledContent>
              </Section>
            </Form>
          </VStack>
        </Group>
      </BottomSheet>
    </Host>
  );
};
