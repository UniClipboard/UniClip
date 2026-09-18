import {
  Icon,
  IconButton,
  OutlinedTextField,
  Text,
  useMaterialColors,
  useNativeState,
} from '@expo/ui/jetpack-compose';
import type { TextFieldKeyboardType, TextFieldColors } from '@expo/ui/jetpack-compose';
import { fillMaxWidth, testID as testIDModifier } from '@expo/ui/jetpack-compose/modifiers';
import { useCallback, useEffect, useRef, useState } from 'react';

const ICONS = {
  visibility: require('../../assets/icons/visibility.xml'),
  visibilityOff: require('../../assets/icons/visibility_off.xml'),
};

export interface AppTextFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  secure?: boolean;
  secureToggleLabel?: string;
  secureHideLabel?: string;
  keyboardType?: TextFieldKeyboardType;
  fullWidth?: boolean;
  colors?: TextFieldColors;
  testID?: string;
}

export function AppTextField({
  value,
  onChangeText,
  placeholder,
  label,
  disabled,
  secure,
  secureToggleLabel,
  secureHideLabel,
  keyboardType,
  fullWidth,
  colors: fieldColors,
  testID,
}: AppTextFieldProps) {
  const colors = useMaterialColors();
  const nativeValue = useNativeState(value);
  const [secureVisible, setSecureVisible] = useState(false);
  const latestNativeValue = useRef(value);
  useEffect(() => {
    if (value === latestNativeValue.current) return;
    latestNativeValue.current = value;
    nativeValue.set(value);
  }, [nativeValue, value]);
  const handleValueChange = useCallback(
    (nextValue: string) => {
      latestNativeValue.current = nextValue;
      onChangeText(nextValue);
    },
    [onChangeText]
  );

  return (
    <OutlinedTextField
      value={nativeValue}
      onValueChange={handleValueChange}
      enabled={disabled !== undefined ? !disabled : undefined}
      singleLine
      visualTransformation={secure && !secureVisible ? 'password' : undefined}
      keyboardOptions={{ keyboardType: secure ? 'password' : keyboardType }}
      colors={fieldColors}
      modifiers={[
        ...(fullWidth ? [fillMaxWidth()] : []),
        ...(testID ? [testIDModifier(testID)] : []),
      ]}
    >
      {label ? (
        <OutlinedTextField.Label>
          <Text>{label}</Text>
        </OutlinedTextField.Label>
      ) : null}
      {placeholder ? (
        <OutlinedTextField.Placeholder>
          <Text>{placeholder}</Text>
        </OutlinedTextField.Placeholder>
      ) : null}
      {secure && secureToggleLabel ? (
        <OutlinedTextField.TrailingIcon>
          <IconButton onClick={() => setSecureVisible((visible) => !visible)}>
            <Icon
              source={secureVisible ? ICONS.visibilityOff : ICONS.visibility}
              size={20}
              tint={colors.onSurfaceVariant}
              contentDescription={
                secureVisible ? secureHideLabel ?? secureToggleLabel : secureToggleLabel
              }
            />
          </IconButton>
        </OutlinedTextField.TrailingIcon>
      ) : null}
    </OutlinedTextField>
  );
}
