import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type DropdownProps = {
  options: Array<{ label: string; value: string }>;
  selectedValue?: string;
  onSelect: (value: string) => void;
  fullWidth?: boolean;
  width?: number;
};

const mockDropdownProps: DropdownProps[] = [];
const mockSetLanguage = jest.fn().mockResolvedValue(undefined);
const mockSetThemeMode = jest.fn().mockResolvedValue(undefined);

jest.mock('@/components/ui', () => ({
  AppDropdown: (props: DropdownProps) => {
    mockDropdownProps.push(props);
    return null;
  },
}));

jest.mock('@expo/ui/jetpack-compose', () => {
  const react = require('react') as typeof import('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    react.createElement(react.Fragment, null, children);
  const SegmentedButton = Object.assign(passthrough, { Label: passthrough });
  const ListItem = Object.assign(passthrough, {
    HeadlineContent: passthrough,
    SupportingContent: passthrough,
    TrailingContent: passthrough,
  });

  return {
    Column: passthrough,
    ListItem,
    Switch: () => null,
    HorizontalDivider: () => null,
    SingleChoiceSegmentedButtonRow: passthrough,
    SegmentedButton,
    Text: passthrough,
    Spacer: () => null,
  };
});

jest.mock('@expo/ui/jetpack-compose/modifiers', () => ({
  fillMaxWidth: () => ({}),
  padding: () => ({}),
  height: () => ({}),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ themeMode: 'auto', setThemeMode: mockSetThemeMode }),
}));

jest.mock('@/stores', () => ({
  useSettingsStore: Object.assign(
    (selector: (state: { config: { hideFromRecents: boolean } }) => unknown) =>
      selector({ config: { hideFromRecents: false } }),
    { getState: () => ({ updateConfig: jest.fn() }) }
  ),
}));

jest.mock('@/i18n/useAppLanguage', () => ({
  useAppLanguage: () => ({ preference: 'system', setLanguage: mockSetLanguage }),
}));

jest.mock('../screens/settings/SettingsToastContext', () => ({
  useSettingsToast: () => jest.fn(),
}));

jest.mock('../screens/settings/SettingsSectionItem', () => ({
  SettingsSectionItem: ({ children }: { children?: React.ReactNode }) => children,
}));

import { AppearanceSection } from '../screens/settings/AppearanceSection';

describe('AppearanceSection compact dropdowns', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDropdownProps.length = 0;
  });

  it('shows appearance and language preferences in compact dropdowns', () => {
    act(() => {
      TestRenderer.create(<AppearanceSection />);
    });

    expect(mockDropdownProps).toHaveLength(2);
    expect(mockDropdownProps[0].selectedValue).toBe('auto');
    expect(mockDropdownProps[0].width).toBe(180);
    expect(mockDropdownProps[0].options.map(({ value }) => value)).toEqual([
      'auto',
      'light',
      'dark',
    ]);
    expect(mockDropdownProps[1].selectedValue).toBe('system');
    expect(mockDropdownProps[1].fullWidth).not.toBe(true);
    expect(mockDropdownProps[1].width).toBe(180);
    expect(mockDropdownProps[1].options.map(({ value }) => value)).toEqual([
      'system',
      'zh-CN',
      'en',
      'ru',
      'pt-BR',
    ]);
  });

  it('applies the appearance selected from the dropdown', async () => {
    act(() => {
      TestRenderer.create(<AppearanceSection />);
    });

    await act(async () => {
      mockDropdownProps[0].onSelect('dark');
      await Promise.resolve();
    });

    expect(mockSetThemeMode).toHaveBeenCalledWith('dark');
  });

  it('applies the language selected from the dropdown', async () => {
    act(() => {
      TestRenderer.create(<AppearanceSection />);
    });

    await act(async () => {
      mockDropdownProps[1].onSelect('ru');
      await Promise.resolve();
    });

    expect(mockSetLanguage).toHaveBeenCalledWith('ru');
  });
});
