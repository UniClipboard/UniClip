import { useEffect, useState } from 'react';
import {
  ExposedDropdownMenuBox,
  ExposedDropdownMenu,
  DropdownMenuItem,
  OutlinedTextField,
  Text as ComposeText,
  useNativeState,
} from '@expo/ui/jetpack-compose';
import {
  menuAnchor,
  fillMaxWidth,
  width as widthModifier,
} from '@expo/ui/jetpack-compose/modifiers';

export interface AppDropdownOption<T extends string = string> {
  label: string;
  value: T;
}

export interface AppDropdownProps<T extends string = string> {
  options: AppDropdownOption<T>[];
  selectedValue?: T;
  onSelect: (value: T) => void;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  width?: number;
}

export function AppDropdown<T extends string = string>({
  options,
  selectedValue,
  onSelect,
  placeholder,
  label,
  disabled,
  fullWidth,
  width,
}: AppDropdownProps<T>) {
  const [expanded, setExpanded] = useState(false);
  const selectedLabel = options.find((o) => o.value === selectedValue)?.label ?? placeholder ?? '';
  const selectedLabelState = useNativeState(selectedLabel);

  useEffect(() => {
    selectedLabelState.set(selectedLabel);
  }, [selectedLabel, selectedLabelState]);

  const boxModifiers =
    width !== undefined ? [widthModifier(width)] : fullWidth ? [fillMaxWidth()] : undefined;
  const fieldModifiers =
    width !== undefined || fullWidth ? [menuAnchor(), fillMaxWidth()] : [menuAnchor()];

  return (
    <ExposedDropdownMenuBox
      expanded={expanded}
      onExpandedChange={(next) => {
        if (!disabled) setExpanded(next);
      }}
      modifiers={boxModifiers}
    >
      <OutlinedTextField
        key={selectedLabel}
        value={selectedLabelState}
        readOnly
        enabled={disabled !== undefined ? !disabled : undefined}
        singleLine
        modifiers={fieldModifiers}
      >
        {label ? <OutlinedTextField.Label>{label}</OutlinedTextField.Label> : null}
      </OutlinedTextField>
      <ExposedDropdownMenu expanded={expanded} onDismissRequest={() => setExpanded(false)}>
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => {
              onSelect(option.value);
              setExpanded(false);
            }}
          >
            <DropdownMenuItem.Text>
              <ComposeText>{option.label}</ComposeText>
            </DropdownMenuItem.Text>
          </DropdownMenuItem>
        ))}
      </ExposedDropdownMenu>
    </ExposedDropdownMenuBox>
  );
}
