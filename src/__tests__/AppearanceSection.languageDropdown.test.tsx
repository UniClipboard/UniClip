import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SelectRowProps = {
  title: string;
  options: Array<{ label: string; value: string }>;
  selectedValue?: string;
  onSelect: (value: string) => void;
};

type SegmentProps = { selected: boolean; onClick: () => void };

const mockSelectRowProps: SelectRowProps[] = [];
const mockSegmentProps: SegmentProps[] = [];
const mockSetLanguage = jest.fn().mockResolvedValue(undefined);
const mockSetThemeMode = jest.fn().mockResolvedValue(undefined);

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
  const SegmentedButton = Object.assign(
    ({ children, ...props }: SegmentProps & { children?: React.ReactNode }) => {
      mockSegmentProps.push(props);
      return react.createElement(react.Fragment, null, children);
    },
    { Label: passthrough }
  );
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

jest.mock('../screens/settings/SettingsSectionItem', () => ({
  SettingsSectionItem: ({ children }: { children?: React.ReactNode }) => children,
}));

import { AppearanceSection } from '../screens/settings/android/AppearanceSection';

describe('AppearanceSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSelectRowProps.length = 0;
    mockSegmentProps.length = 0;
  });

  it('switches the appearance mode from one full-width segmented control', async () => {
    act(() => {
      TestRenderer.create(<AppearanceSection />);
    });

    expect(mockSegmentProps.map(({ selected }) => selected)).toEqual([true, false, false]);

    await act(async () => {
      mockSegmentProps[2].onClick();
      await Promise.resolve();
    });
    expect(mockSetThemeMode).toHaveBeenCalledWith('dark');

    // 再点已选中的项不重复写入
    mockSetThemeMode.mockClear();
    mockSegmentProps[0].onClick();
    expect(mockSetThemeMode).not.toHaveBeenCalled();
  });

  it('picks the language from a full-row selector', async () => {
    act(() => {
      TestRenderer.create(<AppearanceSection />);
    });

    expect(mockSelectRowProps).toHaveLength(1);
    expect(mockSelectRowProps[0].selectedValue).toBe('system');
    expect(mockSelectRowProps[0].options.map(({ value }) => value)).toEqual([
      'system',
      'zh-CN',
      'en',
      'ru',
      'pt-BR',
    ]);

    await act(async () => {
      mockSelectRowProps[0].onSelect('ru');
      await Promise.resolve();
    });

    expect(mockSetLanguage).toHaveBeenCalledWith('ru');
  });
});
