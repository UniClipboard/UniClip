import { OutlinedTextField, useNativeState } from '@expo/ui/jetpack-compose';
import type {
  TextFieldKeyboardType,
  TextFieldColors,
} from '@expo/ui/jetpack-compose';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import type { ColorValue } from 'react-native';

export interface AppTextFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  secure?: boolean;
  keyboardType?: TextFieldKeyboardType;
  fullWidth?: boolean;
  colors?: TextFieldColors;
}

export function AppTextField({
  value,
  onChangeText,
  placeholder,
  label,
  disabled,
  secure,
  keyboardType,
  fullWidth,
  colors,
}: AppTextFieldProps) {
  const nativeValue = useNativeState(value);
  return (
    <OutlinedTextField
      value={nativeValue}
      onValueChange={onChangeText}
      enabled={disabled !== undefined ? !disabled : undefined}
      singleLine
      keyboardOptions={{ keyboardType: secure ? 'password' : keyboardType }}
      colors={colors}
      modifiers={fullWidth ? [fillMaxWidth()] : undefined}
    >
      {label ? (
        <OutlinedTextField.Label>{label}</OutlinedTextField.Label>
      ) : null}
      {placeholder ? (
        <OutlinedTextField.Placeholder>{placeholder}</OutlinedTextField.Placeholder>
      ) : null}
    </OutlinedTextField>
  );
}
