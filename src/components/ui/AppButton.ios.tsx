import { Button } from '@expo/ui/swift-ui';
import {
  buttonStyle,
  disabled as disabledModifier,
  frame,
  foregroundStyle,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import type { ColorValue } from 'react-native';

import { iosOnSaturatedColor } from '@/theme/iosDesignTokens';
import {
  iosAccentButtonPalette,
  iosProminentButtonModifiers,
  iosSecondaryButtonModifiers,
} from './iosButtonStyles.ios';

export type AppButtonVariant = 'filled' | 'outlined' | 'tonal' | 'text';

export interface AppButtonProps {
  title: string;
  onPress: () => void;
  variant?: AppButtonVariant;
  fullWidth?: boolean;
  disabled?: boolean;
  colors?: {
    containerColor?: ColorValue;
    contentColor?: ColorValue;
  };
}

export function AppButton({
  title,
  onPress,
  variant = 'filled',
  fullWidth,
  disabled,
  colors,
}: AppButtonProps) {
  const filledPalette = colors?.containerColor
    ? {
        background: colors.containerColor,
        foreground: colors.contentColor ?? iosOnSaturatedColor,
      }
    : {
        ...iosAccentButtonPalette,
        ...(colors?.contentColor ? { foreground: colors.contentColor } : {}),
      };
  const variantModifiers =
    variant === 'filled'
      ? iosProminentButtonModifiers(filledPalette, { fullWidth })
      : variant === 'outlined' || variant === 'tonal'
      ? [
          ...iosSecondaryButtonModifiers({ fullWidth }),
          ...(colors?.containerColor ? [tint(colors.containerColor)] : []),
          ...(colors?.contentColor ? [foregroundStyle(colors.contentColor)] : []),
        ]
      : [
          buttonStyle('plain'),
          ...(fullWidth ? [frame({ maxWidth: Infinity })] : []),
          ...(colors?.contentColor ? [foregroundStyle(colors.contentColor)] : []),
        ];
  const modifiers = [...variantModifiers, ...(disabled ? [disabledModifier(true)] : [])];
  return <Button label={title} onPress={onPress} modifiers={modifiers} />;
}
