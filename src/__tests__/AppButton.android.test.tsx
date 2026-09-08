import { AppButton } from '@/components/ui/AppButton.android';

jest.mock('@expo/ui/jetpack-compose', () => ({
  Button: 'Button',
  OutlinedButton: 'OutlinedButton',
  FilledTonalButton: 'FilledTonalButton',
  TextButton: 'TextButton',
  Text: 'Text',
}));
jest.mock('@expo/ui/jetpack-compose/modifiers', () => ({
  fillMaxWidth: () => ({ type: 'fillMaxWidth' }),
  defaultMinSize: (options: object) => ({ type: 'defaultMinSize', ...options }),
}));

describe('Android AppButton sizes', () => {
  it.each(['filled', 'outlined', 'tonal', 'text'] as const)(
    'applies large sizing to the %s button while preserving its action',
    (variant) => {
      const onPress = jest.fn();
      const button = AppButton({
        title: 'Continue',
        size: 'large',
        fullWidth: true,
        variant,
        onPress,
      });
      expect(button.props.modifiers).toEqual(
        expect.arrayContaining([
          { type: 'fillMaxWidth' },
          { type: 'defaultMinSize', minHeight: 56 },
        ])
      );
      expect(button.props.children.props.style.fontSize).toBe(16);
      button.props.onClick();
      expect(onPress).toHaveBeenCalledTimes(1);
    }
  );
  it('keeps regular buttons at the native default size', () => {
    const button = AppButton({ title: 'Continue', onPress: jest.fn() });
    expect(button.props.modifiers ?? []).toEqual([]);
    expect(button.props.children.props.style).toBeUndefined();
  });
});
