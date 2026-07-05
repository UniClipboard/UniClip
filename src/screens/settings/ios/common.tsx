import React from 'react';
import { Linking, PlatformColor } from 'react-native';
import {
  Button as SwiftUIButton,
  HStack,
  Image,
  Spacer,
  Text as SwiftUIText,
  Toggle,
} from '@expo/ui/swift-ui';
import {
  background,
  buttonStyle,
  contentShape,
  cornerRadius,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  onTapGesture,
  padding,
  shapes,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';

/** iOS system palette for settings icon tiles (iOS Settings app style). */
export const settingsTileColors = {
  blue: '#007AFF',
  teal: '#32ADE6',
  green: '#34C759',
  orange: '#FF9500',
  red: '#FF3B30',
  indigo: '#5856D6',
  purple: '#AF52DE',
  gray: '#8E8E93',
} as const;

export const chevronColor = '#8E8E93';
export const headerIconColor = '#AEAEB2';
export const statusGreen = settingsTileColors.green;
export const statusOrange = settingsTileColors.orange;

/**
 * iOS 系统绿开关。设置界面根 VStack 级联了墨色 accent tint(SettingsScreen.ios.tsx),
 * 会把 SwiftUI Toggle 的轨道也染成主题色;这里用 systemGreen 覆盖,让所有开关走 iOS
 * 原生绿轨道,而按钮/导航链接等仍保持 accent。新增设置开关统一用本组件而非裸 Toggle。
 */
const switchGreenTint = tint(PlatformColor('systemGreen'));

export function SettingsToggle({ modifiers, ...rest }: React.ComponentProps<typeof Toggle>) {
  return <Toggle {...rest} modifiers={[...(modifiers ?? []), switchGreenTint]} />;
}

/** Rounded-square colored icon, like the leading icons in the iOS Settings app. */
export function SettingsIconTile({ systemName, color }: { systemName: SFSymbol; color: string }) {
  return (
    <Image
      systemName={systemName}
      size={15}
      color="white"
      modifiers={[frame({ width: 28, height: 28 }), background(color), cornerRadius(6)]}
    />
  );
}

export interface SettingsNavRowProps {
  icon: SFSymbol;
  iconColor: string;
  title: string;
  /** Trailing secondary text (count, status, …). */
  value?: string;
  /** Hex color for the trailing text; defaults to secondary label. */
  valueColor?: string;
  onPress: () => void;
}

/** Full-width tappable row: icon tile + title … value + chevron. */
export function SettingsNavRow({
  icon,
  iconColor,
  title,
  value,
  valueColor,
  onPress,
}: SettingsNavRowProps) {
  return (
    <HStack
      spacing={12}
      modifiers={[
        frame({ maxWidth: Infinity }),
        contentShape(shapes.rectangle()),
        onTapGesture(onPress),
      ]}
    >
      <SettingsIconTile systemName={icon} color={iconColor} />
      <SwiftUIText>{title}</SwiftUIText>
      <Spacer />
      {value ? (
        <SwiftUIText
          modifiers={valueColor ? [foregroundStyle(valueColor)] : [foregroundStyle('secondary')]}
        >
          {value}
        </SwiftUIText>
      ) : null}
      <Image systemName="chevron.right" size={12} color={chevronColor} />
    </HStack>
  );
}

/**
 * Numbered guide step. Renders `N.circle.fill`, or a green checkmark once
 * `done` — so setup progress reads at a glance.
 */
export function GuideStepRow({
  index,
  text,
  done,
}: {
  index: 1 | 2 | 3 | 4 | 5;
  text: string;
  done?: boolean;
}) {
  return (
    <HStack spacing={12} alignment="center" modifiers={[frame({ maxWidth: Infinity })]}>
      {done ? (
        <Image systemName="checkmark.circle.fill" size={22} color={statusGreen} />
      ) : (
        <Image systemName={`${index}.circle.fill` as SFSymbol} size={22} color={chevronColor} />
      )}
      <SwiftUIText modifiers={done ? [foregroundStyle('secondary')] : []}>{text}</SwiftUIText>
      <Spacer />
    </HStack>
  );
}

/** Right-aligned status text with a leading dot icon, for LabeledContent-style rows. */
export function StatusValue({ text, tone }: { text: string; tone: 'ok' | 'warn' | 'muted' }) {
  const color = tone === 'ok' ? statusGreen : tone === 'warn' ? statusOrange : undefined;
  return (
    <HStack spacing={5} alignment="center">
      {tone !== 'muted' ? <Image systemName="circle.fill" size={8} color={color} /> : null}
      <SwiftUIText modifiers={color ? [foregroundStyle(color)] : [foregroundStyle('secondary')]}>
        {text}
      </SwiftUIText>
    </HStack>
  );
}

/** Glass circular header button (back chevron, add, …) matching the sheet header style. */
export function HeaderCircleButton({
  systemName,
  onPress,
}: {
  systemName: SFSymbol;
  onPress: () => void;
}) {
  return (
    <SwiftUIButton
      onPress={onPress}
      modifiers={[
        buttonStyle('plain'),
        glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'circle' }),
      ]}
    >
      <Image
        systemName={systemName}
        size={20}
        color={headerIconColor}
        modifiers={[font({ weight: 'semibold' }), padding()]}
      />
    </SwiftUIButton>
  );
}

/** Form-row button that deep-links into this app's page in the iOS Settings app. */
export function OpenSystemSettingsButton({ label = '打开系统设置' }: { label?: string }) {
  return (
    <SwiftUIButton
      systemImage="arrow.up.forward.app"
      label={label}
      onPress={() => {
        Linking.openSettings();
      }}
    />
  );
}
