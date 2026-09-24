import {
  Button as SwiftUIButton,
  HStack,
  Image,
  ProgressView,
  Spacer,
  Text as SwiftUIText,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityHint,
  accessibilityLabel,
  background,
  buttonStyle,
  contentShape,
  cornerRadius,
  font,
  foregroundStyle,
  frame,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import { PlatformColor } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';
import { useTranslation } from 'react-i18next';

import type { DeviceTrustDeviceView } from '@/features/space';
import { iosColors } from '@/theme/iosDesignTokens';
import { chevronColor, settingsTileColors, statusGreen } from '@/screens/settings/ios/common';

const OFFLINE_DOT = '#C7C7CC';

/** 设备页行的前导图标:36pt 圆角方块,系统填充色底 */
export function DeviceIconTile({ systemName }: { systemName: SFSymbol }) {
  return (
    <Image
      systemName={systemName}
      size={18}
      color={iosColors?.label}
      modifiers={[
        frame({ width: 36, height: 36 }),
        background(PlatformColor('tertiarySystemFill')),
        cornerRadius(9),
      ]}
    />
  );
}

/** 设备当前状态的文案与状态点颜色;本机不显示状态点 */
export function deviceStatus(
  device: DeviceTrustDeviceView,
  t: (key: string) => string
): { label: string; dot: string | null } {
  if (device.primaryStatus === 'removalAcknowledgementPending') {
    return { label: t(`space.deviceTrust.status.${device.primaryStatus}`), dot: settingsTileColors.blue };
  }
  if (device.primaryStatus !== 'usable' && device.primaryStatus !== 'unknown') {
    return {
      label: t(`space.deviceTrust.status.${device.primaryStatus}`),
      dot: settingsTileColors.orange,
    };
  }
  if (device.isLocal) return { label: t('space.devices.thisDevice'), dot: null };
  return device.reachability === 'online'
    ? { label: t('space.devices.online'), dot: statusGreen }
    : { label: t('space.devices.offline'), dot: OFFLINE_DOT };
}

/**
 * 设备行:整行可点(打开设备详情),图标 + 名称 / 状态 + 状态点 + 箭头。
 * 移除进行中时以进度圈代替箭头且不可点。
 */
export function SpaceDeviceRow({
  device,
  removing,
  onManage,
}: {
  device: DeviceTrustDeviceView;
  removing: boolean;
  onManage: () => void;
}) {
  const { t } = useTranslation('settingsSync');
  const status = deviceStatus(device, t);
  const content = (
    <HStack
      spacing={16}
      alignment="center"
      modifiers={[frame({ maxWidth: Infinity, minHeight: 48 }), contentShape(shapes.rectangle())]}
    >
      <DeviceIconTile systemName={device.isLocal ? 'iphone' : 'laptopcomputer'} />
      <VStack alignment="leading" spacing={1}>
        <SwiftUIText>{device.displayName}</SwiftUIText>
        <SwiftUIText modifiers={[font({ size: 13 }), foregroundStyle('secondary')]}>
          {status.label}
        </SwiftUIText>
      </VStack>
      <Spacer />
      {status.dot ? <Image systemName="circle.fill" size={8} color={status.dot} /> : null}
      {removing ? <ProgressView /> : <Image systemName="chevron.right" size={13} color={chevronColor} />}
    </HStack>
  );
  if (removing) return content;
  return (
    <SwiftUIButton
      onPress={onManage}
      modifiers={[
        buttonStyle('plain'),
        accessibilityLabel(`${device.displayName}, ${status.label}`),
        accessibilityHint(t('space.devices.manageHint')),
      ]}
    >
      {content}
    </SwiftUIButton>
  );
}
