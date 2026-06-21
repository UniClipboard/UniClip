import {
  Button,
  OutlinedButton,
  FilledTonalButton,
  TextButton,
  Text as ComposeText,
} from '@expo/ui/jetpack-compose';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
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

const VARIANT_MAP = {
  filled: Button,
  outlined: OutlinedButton,
  tonal: FilledTonalButton,
  text: TextButton,
} as const;

export function AppButton({
  title,
  onPress,
  variant = 'filled',
  fullWidth,
  disabled,
  colors,
}: AppButtonProps) {
  const Component = VARIANT_MAP[variant];
  return (
    <Component
      onClick={onPress}
      enabled={disabled !== undefined ? !disabled : undefined}
      colors={colors}
      modifiers={fullWidth ? [fillMaxWidth()] : undefined}
    >
      <ComposeText>{title}</ComposeText>
    </Component>
  );
}
