import React, { useEffect } from 'react';
import {
  HStack,
  Image,
  LabeledContent,
  Link,
  Picker,
  Section,
  Spacer,
  Text as SwiftUIText,
} from '@expo/ui/swift-ui';
import { foregroundStyle, frame, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import { useSettingsStore } from '@/stores';
import { useTheme } from '@/hooks/useTheme';
import { APP_VERSION } from '@/constants';
import type { ThemeMode } from '@/theme';
import {
  chevronColor,
  SettingsIconTile,
  SettingsNavRow,
  SettingsToggle,
  settingsTileColors,
  statusGreen,
  statusOrange,
} from './common';
import { useKeyboardStatus } from './useKeyboardStatus';
import type { SettingsPage } from './types';

function IconToggleRow({
  icon,
  iconColor,
  label,
  isOn,
  onIsOnChange,
}: {
  icon: SFSymbol;
  iconColor: string;
  label: string;
  isOn: boolean;
  onIsOnChange: (v: boolean) => void;
}) {
  return (
    <HStack spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
      <SettingsIconTile systemName={icon} color={iconColor} />
      <SettingsToggle label={label} isOn={isOn} onIsOnChange={onIsOnChange} />
    </HStack>
  );
}

export function SettingsRootPage({
  onNavigate,
  active = true,
}: {
  onNavigate: (page: SettingsPage) => void;
  active?: boolean;
}) {
  const { config, updateConfig } = useSettingsStore();
  const { setThemeMode } = useTheme();
  const keyboard = useKeyboardStatus();
  const refreshKeyboard = keyboard.refresh;

  // The page stays mounted while sub-pages are shown; re-check the keyboard
  // hint when the user slides back (they may have just finished the setup).
  useEffect(() => {
    if (active) refreshKeyboard();
  }, [active, refreshKeyboard]);

  if (!config) return null;

  const servers = config.servers ?? [];

  const keyboardHint =
    keyboard.state === 'ready'
      ? { value: '已启用', color: statusGreen }
      : keyboard.state === 'added'
        ? { value: '需完全访问', color: statusOrange }
        : keyboard.state === 'notAdded'
          ? { value: '未启用', color: undefined }
          : { value: undefined, color: undefined };

  return (
    <IosSheetPage title="设置">
      <IosSheetForm>
        {/* ── 服务器 ── */}
        <Section>
          <SettingsNavRow
            icon="server.rack"
            iconColor={settingsTileColors.blue}
            title="服务器"
            value={`${servers.length} 个`}
            onPress={() => onNavigate('servers')}
          />
        </Section>

        {/* ── 同步 ── */}
        <Section
          header={<SwiftUIText>同步</SwiftUIText>}
          footer={
            <SwiftUIText>
              开启「自动写入」后，服务器有新内容时会立即覆盖本机剪贴板；关闭则只在主页高亮提示。
            </SwiftUIText>
          }
        >
          <IconToggleRow
            icon="arrow.down.doc"
            iconColor={settingsTileColors.green}
            label="自动写入本机剪贴板"
            isOn={config.autoApplyRemote}
            onIsOnChange={(v) => updateConfig({ autoApplyRemote: v })}
          />
          <IconToggleRow
            icon="arrow.up.doc"
            iconColor={settingsTileColors.teal}
            label="自动推送本机剪贴板"
            isOn={config.autoPushLocal}
            onIsOnChange={(v) => updateConfig({ autoPushLocal: v })}
          />
          <IconToggleRow
            icon="bolt.horizontal"
            iconColor={settingsTileColors.orange}
            label="实时推送 (SSE)"
            isOn={config.enableSse}
            onIsOnChange={(v) => useSettingsStore.getState().setEnableSse(v)}
          />
        </Section>

        {/* ── 扩展与权限 ── */}
        <Section
          header={<SwiftUIText>扩展与权限</SwiftUIText>}
          footer={
            <SwiftUIText>
              键盘和分享扩展让你在其他 App 里直接使用
              UniClip；剪贴板访问设为「允许」可避免同步时反复弹窗。
            </SwiftUIText>
          }
        >
          <SettingsNavRow
            icon="keyboard"
            iconColor={settingsTileColors.indigo}
            title="键盘"
            value={keyboardHint.value}
            valueColor={keyboardHint.color}
            onPress={() => onNavigate('keyboard')}
          />
          <SettingsNavRow
            icon="square.and.arrow.up"
            iconColor={settingsTileColors.green}
            title="分享"
            onPress={() => onNavigate('share')}
          />
          <SettingsNavRow
            icon="doc.on.clipboard"
            iconColor={settingsTileColors.orange}
            title="剪贴板访问权限"
            onPress={() => onNavigate('clipboard')}
          />
        </Section>

        {/* ── 存储 ── */}
        <Section>
          <SettingsNavRow
            icon="externaldrive"
            iconColor={settingsTileColors.purple}
            title="存储"
            onPress={() => onNavigate('storage')}
          />
        </Section>

        {/* ── 通用 ── */}
        <Section header={<SwiftUIText>通用</SwiftUIText>}>
          <HStack spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
            <SettingsIconTile systemName="circle.lefthalf.filled" color={settingsTileColors.gray} />
            <Picker
              label="主题"
              selection={config.appearance}
              onSelectionChange={(v) => {
                const appearance = v as 'system' | 'light' | 'dark';
                updateConfig({ appearance });
                const modeMap: Record<string, ThemeMode> = {
                  system: 'auto',
                  light: 'light',
                  dark: 'dark',
                };
                setThemeMode(modeMap[appearance] ?? 'auto');
              }}
              modifiers={[pickerStyle('menu')]}
            >
              <SwiftUIText modifiers={[tag('system')]}>跟随系统</SwiftUIText>
              <SwiftUIText modifiers={[tag('light')]}>浅色</SwiftUIText>
              <SwiftUIText modifiers={[tag('dark')]}>深色</SwiftUIText>
            </Picker>
          </HStack>

          <IconToggleRow
            icon="arrow.triangle.2.circlepath"
            iconColor={settingsTileColors.red}
            label="启动时检查更新"
            isOn={config.autoCheckUpdate}
            onIsOnChange={(v) => updateConfig({ autoCheckUpdate: v })}
          />
        </Section>

        {/* ── 关于 ── */}
        <Section header={<SwiftUIText>关于</SwiftUIText>}>
          <Link destination="https://github.com/UniClipboard/UniClipboard">
            <HStack spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
              <SettingsIconTile systemName="globe" color={settingsTileColors.gray} />
              <SwiftUIText>项目主页</SwiftUIText>
              <Spacer />
              <Image systemName="arrow.up.right" size={12} color={chevronColor} />
            </HStack>
          </Link>

          <LabeledContent
            label={
              <HStack spacing={12}>
                <SettingsIconTile systemName="info.circle" color={settingsTileColors.gray} />
                <SwiftUIText>版本</SwiftUIText>
              </HStack>
            }
          >
            <SwiftUIText modifiers={[foregroundStyle('secondary')]}>{APP_VERSION}</SwiftUIText>
          </LabeledContent>
        </Section>
      </IosSheetForm>
    </IosSheetPage>
  );
}
