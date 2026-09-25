import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SelectRowProps = {
  testID?: string;
  icon?: number;
  title: string;
  options: Array<{ label: string; value: string }>;
  selectedValue?: string;
  onSelect: (value: string) => void;
};

const mockSelectRowProps: SelectRowProps[] = [];
const mockSetLanguage = jest.fn().mockResolvedValue(undefined);
const mockSetThemeMode = jest.fn().mockResolvedValue(undefined);

jest.mock('@/assets/icons/palette.xml', () => 1);
jest.mock('@/assets/icons/public.xml', () => 2);
jest.mock('@/assets/icons/visibility_off.xml', () => 3);

jest.mock('../screens/settings/android/SettingsSelectRow', () => ({
  SettingsSelectRow: (props: SelectRowProps) => {
    mockSelectRowProps.push(props);
    return null;
  },
}));

jest.mock('../screens/settings/android/SettingsSwitchRow', () => ({
  SettingsSwitchRow: () => null,
}));

jest.mock('@expo/ui/jetpack-compose', () => {
  const react = require('react') as typeof import('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    react.createElement(react.Fragment, null, children);
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
    Text: passthrough,
    Spacer: () => null,
  };
});

jest.mock('@expo/ui/jetpack-compose/modifiers', () => ({
  fillMaxWidth: () => ({}),
  padding: () => ({}),
  height: () => ({}),
  testID: () => ({}),
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

jest.mock('../screens/settings/android/SettingsLeadingIcon', () => ({
  SettingsLeadingIcon: () => null,
}));

import { LanguageSelectRow, ThemeSelectRow } from '../screens/settings/android/AppearanceRows';

describe('Android appearance hub rows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSelectRowProps.length = 0;
  });

  it('switches the theme from a full-row selector with a leading icon', async () => {
    act(() => {
      TestRenderer.create(<ThemeSelectRow />);
    });

    expect(mockSelectRowProps).toHaveLength(1);
    const [row] = mockSelectRowProps;
    expect(row.testID).toBe('settings-theme');
    expect(row.icon).toBeDefined();
    expect(row.selectedValue).toBe('auto');
    expect(row.options.map(({ value }) => value)).toEqual(['auto', 'light', 'dark']);

    await act(async () => {
      row.onSelect('dark');
      await Promise.resolve();
    });
    expect(mockSetThemeMode).toHaveBeenCalledWith('dark');
  });

  it('picks the language from a full-row selector with a leading icon', async () => {
    act(() => {
      TestRenderer.create(<LanguageSelectRow />);
    });

    expect(mockSelectRowProps).toHaveLength(1);
    const [row] = mockSelectRowProps;
    expect(row.testID).toBe('settings-language');
    expect(row.icon).toBeDefined();
    expect(row.selectedValue).toBe('system');
    expect(row.options.map(({ value }) => value)).toEqual(['system', 'zh-CN', 'en', 'ru', 'pt-BR']);

    await act(async () => {
      row.onSelect('ru');
      await Promise.resolve();
    });
    expect(mockSetLanguage).toHaveBeenCalledWith('ru');
  });
});
