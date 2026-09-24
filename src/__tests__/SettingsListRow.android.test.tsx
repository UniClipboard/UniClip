/// <reference types="node" />
import fs from 'fs';
import path from 'path';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { SettingsListRow } from '../screens/settings/android/SettingsListRow';
import { SettingsSelectRow } from '../screens/settings/android/SettingsSelectRow';

jest.mock('@/assets/icons/chevron_right.xml', () => 1);
jest.mock('@/assets/icons/expand_more.xml', () => 2);
jest.mock('@/assets/icons/check.xml', () => 3);
jest.mock('@expo/ui/jetpack-compose', () => {
  const react = require('react') as typeof import('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    react.createElement(react.Fragment, null, children);
  const ListItem = Object.assign(
    (props: object) => react.createElement('row', props),
    {
      LeadingContent: 'leading',
      HeadlineContent: 'headline',
      SupportingContent: 'support',
      TrailingContent: 'trailing',
    }
  );
  const DropdownMenu = Object.assign(
    (props: object) => react.createElement('menu', props),
    { Trigger: passthrough, Items: passthrough }
  );
  const DropdownMenuItem = Object.assign(
    (props: object) => react.createElement('menuItem', props),
    { Text: passthrough, TrailingIcon: passthrough }
  );
  return {
    ListItem,
    DropdownMenu,
    DropdownMenuItem,
    Icon: 'icon',
    Row: passthrough,
    Text: 'text',
    Box: passthrough,
    Surface: passthrough,
    Shape: { RoundedCorner: () => ({}) },
    useMaterialColors: () => ({}),
  };
});
jest.mock('@expo/ui/jetpack-compose/modifiers', () => ({
  clickable: (handler: () => void) => ({ type: 'clickable', handler }),
  testID: (id: string) => ({ type: 'testID', id }),
  fillMaxWidth: () => ({ type: 'fillMaxWidth' }),
  size: () => ({ type: 'size' }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Modifier = { type: string; handler?: () => void; id?: string };
const rowModifiers = (renderer: TestRenderer.ReactTestRenderer): Modifier[] =>
  renderer.root.findByType('row' as React.ElementType).props.modifiers;

describe('SettingsListRow', () => {
  it('puts the press handler and testID on the whole row, not on its trailing hint', async () => {
    const press = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <SettingsListRow
          testID="storage-clear-cache"
          title="Cache"
          trailing={{ action: 'Clean up' }}
          onPress={press}
        />
      );
    });

    const modifiers = rowModifiers(renderer);
    expect(modifiers.find((m) => m.type === 'testID')?.id).toBe('storage-clear-cache');
    modifiers.find((m) => m.type === 'clickable')?.handler?.();
    expect(press).toHaveBeenCalledTimes(1);
    // 尾部标签只是提示,本身不带独立点击
    const trailing = renderer.root.findByType('trailing' as React.ElementType);
    expect(trailing.findByType('text' as React.ElementType).props.onClick).toBeUndefined();

    await act(async () => {
      renderer.update(
        <SettingsListRow title="Cache" trailing={{ action: 'Clean up' }} onPress={press} disabled />
      );
    });
    expect(rowModifiers(renderer).some((m) => m.type === 'clickable')).toBe(false);
    await act(async () => renderer.unmount());
  });
});

describe('SettingsSelectRow', () => {
  it('opens the menu from anywhere on the row and reports only a changed choice', async () => {
    const select = jest.fn();
    const options = [
      { label: 'Error', value: 'error' },
      { label: 'Debug', value: 'debug' },
    ];
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <SettingsSelectRow title="Log level" options={options} selectedValue="error" onSelect={select} />
      );
    });

    const menu = () => renderer.root.findByType('menu' as React.ElementType);
    expect(menu().props.expanded).toBe(false);
    await act(async () => {
      rowModifiers(renderer).find((m) => m.type === 'clickable')?.handler?.();
    });
    expect(menu().props.expanded).toBe(true);

    const items = renderer.root.findAllByType('menuItem' as React.ElementType);
    await act(async () => items[0].props.onClick());
    expect(select).not.toHaveBeenCalled();
    expect(menu().props.expanded).toBe(false);

    await act(async () => {
      rowModifiers(renderer).find((m) => m.type === 'clickable')?.handler?.();
    });
    await act(async () => items[1].props.onClick());
    expect(select).toHaveBeenCalledWith('debug');
    await act(async () => renderer.unmount());
  });
});

describe('Android settings pages reuse the grouped row components', () => {
  const read = (relative: string) =>
    fs.readFileSync(path.join(__dirname, '..', 'screens', relative), 'utf8');

  it('builds every hub entry from SettingsListRow inside grouped sections', () => {
    const hub = read('SettingsScreen.android.tsx');
    expect(hub).toMatch(/const HubRow[\s\S]*?<SettingsListRow[\s\S]*?trailing="chevron"/);
    expect(hub).not.toContain('<ListItem');
    expect(hub).not.toContain('HorizontalDivider');
    expect(hub.match(/<SettingsSectionItem\b/g)).toHaveLength(
      hub.match(/<SettingsSectionItem\s+variant="grouped"/g)?.length ?? -1
    );
    for (const section of ['history', 'background', 'appearance', 'storage', 'diagnostics', 'privacy', 'about', 'developer']) {
      expect(hub).toContain(`section="${section}"`);
    }
  });

  it('drops card dividers from every settings sub page', () => {
    for (const page of [
      'settings/HistorySection.tsx',
      'settings/StorageSection.tsx',
      'settings/AboutSection.tsx',
      'settings/QuickActionsSection.tsx',
      'settings/LogSection.android.tsx',
      'settings/AnalyticsConsentControl.android.tsx',
      'settings/android/AppearanceSection.tsx',
      'settings/android/BackgroundSection.tsx',
      'settings/android/DebugSection.tsx',
    ]) {
      const source = read(page);
      expect(source).not.toContain('HorizontalDivider');
      expect(source).toContain('variant="grouped"');
    }
  });

  it('reads grouped row colors inside every shared row component', () => {
    for (const row of ['settings/android/SettingsListRow.tsx', 'settings/android/SettingsSwitchRow.tsx']) {
      expect(read(row)).toContain('useSettingsSectionRowColors()');
      expect(read(row)).toContain('colors={rowColors}');
    }
  });
});
