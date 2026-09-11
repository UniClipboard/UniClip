import { ListItem, Switch as ComposeSwitch, Text as ComposeText } from '@expo/ui/jetpack-compose';
import { testID as testIDModifier, toggleable } from '@expo/ui/jetpack-compose/modifiers';

interface SettingsSwitchRowProps {
  title: string;
  testID?: string;
  description?: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
}

export function SettingsSwitchRow({
  title,
  testID,
  description,
  value,
  disabled = false,
  onValueChange,
}: SettingsSwitchRowProps) {
  const toggle = () => {
    if (!disabled) onValueChange(!value);
  };
  return (
    <ListItem modifiers={[...(testID ? [testIDModifier(testID)] : []), toggleable(value, toggle, { role: 'switch' })]}>
      <ListItem.HeadlineContent>
        <ComposeText>{title}</ComposeText>
      </ListItem.HeadlineContent>
      {description ? (
        <ListItem.SupportingContent>
          <ComposeText>{description}</ComposeText>
        </ListItem.SupportingContent>
      ) : null}
      <ListItem.TrailingContent>
        <ComposeSwitch enabled={!disabled} value={value} onCheckedChange={toggle} />
      </ListItem.TrailingContent>
    </ListItem>
  );
}
