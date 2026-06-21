import { useState } from 'react';
import {
  ExposedDropdownMenuBox,
  ExposedDropdownMenu,
  DropdownMenuItem,
  OutlinedTextField,
  Text as ComposeText,
} from '@expo/ui/jetpack-compose';
import { menuAnchor, fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';

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
}

export function AppDropdown<T extends string = string>({
  options,
  selectedValue,
  onSelect,
  placeholder,
  label,
  disabled,
  fullWidth,
}: AppDropdownProps<T>) {
  const [expanded, setExpanded] = useState(false);
  const selectedLabel =
    options.find((o) => o.value === selectedValue)?.label ?? placeholder ?? '';

  return (
    <ExposedDropdownMenuBox
      expanded={expanded}
      onExpandedChange={(next) => {
        if (!disabled) setExpanded(next);
      }}
      modifiers={fullWidth ? [fillMaxWidth()] : undefined}
    >
      <OutlinedTextField
        key={selectedLabel}
        defaultValue={selectedLabel}
        readOnly
        enabled={disabled !== undefined ? !disabled : undefined}
        singleLine
        modifiers={[menuAnchor()]}
      >
        {label ? (
          <OutlinedTextField.Label>{label}</OutlinedTextField.Label>
        ) : null}
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
