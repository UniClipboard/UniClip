import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import type { RelayOverview } from '@/features/relayOverview';
import { loadRelayOverview, refreshCustomRelays } from '@/features/relaySettings';
import { RelaySettingsSection } from '@/screens/settings/android/RelaySettingsSection';
import { OVERVIEW_RETRY_DELAYS_MS } from '@/screens/settings/useCustomRelaySettings';

const mockUpdateConfig = jest.fn();
const mockPush = jest.fn();

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    useNavigation: () => ({ push: mockPush, goBack: jest.fn() }),
    useFocusEffect: (effect: () => void) => React.useEffect(effect, [effect]),
  };
});

jest.mock('@/assets/icons/add.xml', () => 1);
jest.mock('@/assets/icons/chevron_right.xml', () => 1);
jest.mock('@/assets/icons/public.xml', () => 1);
jest.mock('@/assets/icons/info.xml', () => 1);
jest.mock('app-group-store', () => ({ getEngineLogFileUris: () => [] }));

jest.mock('@/features/relaySettings', () => ({
  subscribeRelayChanges: () => () => undefined,
  loadRelayOverview: jest.fn(),
  refreshCustomRelays: jest.fn().mockResolvedValue([]),
  saveCustomRelay: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/stores', () => ({
  useSettingsStore: (selector: (state: object) => unknown) =>
    selector({ config: { customRelayUrls: [] }, updateConfig: mockUpdateConfig }),
}));

jest.mock('@/components/ui', () => {
  const React = require('react');
  return {
    AppTextField: (props: object) => React.createElement('AppTextField', props),
    SheetPageTransition: ({ firstPage }: { firstPage: React.ReactNode }) => firstPage,
  };
});

jest.mock('@/screens/settings/SettingsSectionItem', () => {
  return {
    SettingsSectionItem: ({ children }: { children: unknown }) => children,
    useSettingsSectionRowColors: () => ({}),
  };
});

jest.mock('@/screens/settings/android/SettingsLeadingIcon', () => ({
  SettingsLeadingIcon: () => null,
}));

jest.mock('@expo/ui/jetpack-compose', () => {
  const React = require('react');
  const el = (name: string) => (props: { children?: React.ReactNode }) =>
    React.createElement(name, props, props.children);
  const ListItem = el('ListItem') as unknown as Record<string, unknown>;
  for (const part of ['LeadingContent', 'HeadlineContent', 'SupportingContent', 'TrailingContent']) {
    ListItem[part] = el(part);
  }
  return {
    Button: el('Button'),
    Column: el('Column'),
    Icon: el('Icon'),
    ListItem,
    Row: el('Row'),
    Shape: { RoundedCorner: () => ({}) },
    Surface: el('Surface'),
    OutlinedButton: el('OutlinedButton'),
    Spacer: el('Spacer'),
    Text: el('Text'),
    TextButton: el('TextButton'),
    useMaterialColors: () =>
      new Proxy({}, { get: () => '#000000' }),
  };
});

jest.mock('@expo/ui/jetpack-compose/modifiers', () => {
  const modifier = (type: string) => (...args: unknown[]) => ({ type, args });
  return {
    clickable: (onClick: () => void) => ({ type: 'clickable', onClick }),
    fillMaxSize: modifier('fillMaxSize'),
    fillMaxWidth: modifier('fillMaxWidth'),
    height: modifier('height'),
    imePadding: modifier('imePadding'),
    padding: modifier('padding'),
    testID: (id: string) => ({ type: 'testID', id }),
    width: modifier('width'),
  };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const builtInEntry = (regionId: string | null, url: string, inEffect = true) => ({
  source: 'builtIn' as const,
  regionId,
  url,
  credentialConfigured: false,
  inEffect,
});
const overview = (patch: Partial<RelayOverview> = {}): RelayOverview => ({
  savedMode: 'builtIn',
  appliedMode: 'builtIn',
  changePending: false,
  entries: [],
  ...patch,
});
beforeEach(() => {
  mockPush.mockClear();
  jest.mocked(loadRelayOverview).mockReset().mockResolvedValue(overview());
});

const modifierOf = (node: TestRenderer.ReactTestInstance, type: string) =>
  (node.props.modifiers as Array<{ type: string; id?: string; onClick?: () => void }> | undefined)?.find(
    (item) => item.type === type
  );
const textsOf = (view: TestRenderer.ReactTestRenderer) =>
  view.root.findAllByType('Text' as never).map((text) => [text.props.children].flat().join(''));
async function render() {
  let view!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    view = TestRenderer.create(<RelaySettingsSection />);
  });
  return view;
}
const builtInItems = (view: TestRenderer.ReactTestRenderer) =>
  view.root
    .findAllByType('ListItem' as never)
    .filter((item) => modifierOf(item, 'testID')?.id?.startsWith('relay-builtin-'));

it('lists built-in relays as non-interactive rows with localized name, address and source', async () => {
  jest.mocked(loadRelayOverview).mockResolvedValue(
    overview({
      entries: [
        builtInEntry('eu', 'https://eu.relay.example./'),
        builtInEntry('mars', 'https://mars.relay.example./'),
      ],
    })
  );
  const view = await render();
  try {
    const rows = builtInItems(view);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => !modifierOf(row, 'clickable'))).toBe(true);
    const texts = textsOf(view);
    expect(texts).toEqual(
      expect.arrayContaining(['relay.region.eu', 'https://eu.relay.example./', 'https://mars.relay.example./'])
    );
    expect(texts).toContain('relay.source.builtIn');
    expect(JSON.stringify(texts)).not.toMatch(/connected/i);
  } finally {
    act(() => view.unmount());
  }
});

it('shows a full-row retry when the overview fails and refreshes it on retry', async () => {
  jest.useFakeTimers();
  jest.mocked(loadRelayOverview).mockRejectedValue(new Error('unavailable'));
  const view = await render();
  try {
    // Quiet retries first (Engine may still be starting), then the full-row retry appears.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(OVERVIEW_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0));
    });
    const retry = view.root
      .findAllByType('ListItem' as never)
      .find((item) => modifierOf(item, 'testID')?.id === 'relay-overview-retry')!;
    expect(builtInItems(view)).toHaveLength(0);
    jest.mocked(loadRelayOverview).mockResolvedValue(
      overview({ entries: [builtInEntry('eu', 'https://eu.relay.example./')] })
    );
    await act(async () => modifierOf(retry, 'clickable')!.onClick!());
    expect(builtInItems(view)).toHaveLength(1);
  } finally {
    act(() => view.unmount());
    jest.useRealTimers();
  }
});

it('reports a pending change as needing a full node rebuild and an unstarted node', async () => {
  jest.mocked(loadRelayOverview).mockResolvedValue(
    overview({
      appliedMode: null,
      savedMode: 'custom',
      changePending: true,
      entries: [builtInEntry('eu', 'https://eu.relay.example./', false)],
    })
  );
  const view = await render();
  try {
    const texts = textsOf(view);
    expect(texts).toEqual(
      expect.arrayContaining(['relay.status.pending', 'relay.status.nodeNotStarted', 'relay.usage.replacedByCustom'])
    );
  } finally {
    act(() => view.unmount());
  }
});

it('re-reads the overview each time the relay page opens', async () => {
  const view = await render();
  try {
    expect(jest.mocked(loadRelayOverview).mock.calls.length).toBeGreaterThanOrEqual(2);
  } finally {
    act(() => view.unmount());
  }
});

it('opens add and edit as their own pushed page instead of editing in place', async () => {
  jest.mocked(refreshCustomRelays).mockResolvedValue([
    { url: 'https://mine.example.com', credentialConfigured: true },
  ]);
  const view = await render();
  try {
    expect(view.root.findAllByType('AppTextField' as never)).toHaveLength(0);
    const add = view.root
      .findAllByType('Button' as never)
      .find((button) => modifierOf(button, 'testID')?.id === 'relay-add')!;
    act(() => add.props.onClick());
    expect(mockPush).toHaveBeenLastCalledWith('SettingsSub', {
      section: 'relayEditor',
      relayUrl: undefined,
    });
    const row = view.root
      .findAllByType('ListItem' as never)
      .find((item) => modifierOf(item, 'clickable') && !modifierOf(item, 'testID'))!;
    act(() => modifierOf(row, 'clickable')!.onClick!());
    expect(mockPush).toHaveBeenLastCalledWith('SettingsSub', {
      section: 'relayEditor',
      relayUrl: 'https://mine.example.com',
    });
  } finally {
    act(() => view.unmount());
  }
});
