/**
 * 单选设置行(Android):整行作为 DropdownMenu 的触发区,尾部显示当前取值。
 *
 * 取代行尾独立的下拉按钮——点行内任意位置(含空白处)都会展开菜单,菜单锚定在行下方。
 */
import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuItem,
  Icon,
  Text as ComposeText,
} from '@expo/ui/jetpack-compose';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';

import { SettingsListRow } from './SettingsListRow';

const CHECK_ICON = require('../../../assets/icons/check.xml');

export interface SettingsSelectOption<T extends string> {
  label: string;
  value: T;
}

interface SettingsSelectRowProps<T extends string> {
  title: string;
  description?: string;
  options: SettingsSelectOption<T>[];
  selectedValue: T | undefined;
  onSelect: (value: T) => void;
  disabled?: boolean;
  testID?: string;
}

export function SettingsSelectRow<T extends string>({
  title,
  description,
  options,
  selectedValue,
  onSelect,
  disabled,
  testID,
}: SettingsSelectRowProps<T>) {
  const [expanded, setExpanded] = useState(false);
  const selectedLabel = options.find((option) => option.value === selectedValue)?.label ?? '';

  return (
    <DropdownMenu
      expanded={expanded}
      onDismissRequest={() => setExpanded(false)}
      modifiers={[fillMaxWidth()]}
    >
      <DropdownMenu.Trigger>
        <SettingsListRow
          title={title}
          description={description}
          trailing={{ value: selectedLabel }}
          onPress={() => setExpanded(true)}
          disabled={disabled}
          testID={testID}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Items>
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => {
              setExpanded(false);
              if (option.value !== selectedValue) onSelect(option.value);
            }}
          >
            <DropdownMenuItem.Text>
              <ComposeText>{option.label}</ComposeText>
            </DropdownMenuItem.Text>
            {option.value === selectedValue ? (
              <DropdownMenuItem.TrailingIcon>
                <Icon source={CHECK_ICON} size={20} />
              </DropdownMenuItem.TrailingIcon>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenu.Items>
    </DropdownMenu>
  );
}
