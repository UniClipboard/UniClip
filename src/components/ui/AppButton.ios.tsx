import { Button } from '@expo/ui/swift-ui';
import {
  buttonStyle,
  disabled as disabledModifier,
  frame,
  tint,
  foregroundStyle,
} from '@expo/ui/swift-ui/modifiers';
import type { ColorValue } from 'react-native';

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

const STYLE_MAP = {
  filled: 'borderedProminent',
  outlined: 'bordered',
  tonal: 'bordered',
  text: 'plain',
} as const;

export function AppButton({
  title,
  onPress,
  variant = 'filled',
  fullWidth,
  disabled,
  colors,
}: AppButtonProps) {
  const modifiers = [
    buttonStyle(STYLE_MAP[variant]),
    ...(fullWidth ? [frame({ maxWidth: Infinity })] : []),
    ...(disabled ? [disabledModifier(true)] : []),
    ...(colors?.containerColor ? [tint(colors.containerColor as string)] : []),
    ...(colors?.contentColor ? [foregroundStyle(colors.contentColor as string)] : []),
  ];
  return <Button label={title} onPress={onPress} modifiers={modifiers} />;
}
