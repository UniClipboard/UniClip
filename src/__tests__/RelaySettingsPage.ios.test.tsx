import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { loadRelayOverview } from '@/features/relaySettings';
import type { RelayOverview } from '@/features/relayOverview';
import { RelaySettingsPage } from '@/screens/ios/devices/RelaySettingsPage';
import {
  OVERVIEW_RETRY_DELAYS_MS,
  useCustomRelaySettings,
} from '@/screens/settings/useCustomRelaySettings';

const onAddRelay = jest.fn();
const onEditRelay = jest.fn();
function CustomRelaySection() {
  const relay = useCustomRelaySettings();
  return <RelaySettingsPage relay={relay} onAddRelay={onAddRelay} onEditRelay={onEditRelay} />;
}

jest.mock('app-group-store', () => ({
  getEngineLogFileUris: () => [],
}));

const mockUpdateConfig = jest.fn();

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
    selector({
      config: { customRelayUrls: [] },
      updateConfig: mockUpdateConfig,
    }),
}));

jest.mock('@/components/ui', () => ({
  IosSheetForm: ({ children }: { children: unknown }) => children,
  IosSheetPage: ({ children }: { children: unknown }) => children,
}));

jest.mock('@/screens/settings/ios/common', () => {
  const React = require('react');
  return {
    settingsTileColors: { blue: '#007AFF', orange: '#FF9500' },
    SettingsNavRow: (props: object) => React.createElement('SettingsNavRow', props),
  };
});

jest.mock('@expo/ui/swift-ui', () => {
  const React = require('react');
  return {
    Button: (props: object) => React.createElement('Button', props),
    HStack: (props: object) => React.createElement('HStack', props),
    Image: (props: object) => React.createElement('Image', props),
    VStack: (props: object) => React.createElement('VStack', props),
    Section: (props: object) => React.createElement('Section', props),
    SecureField: (props: object) => React.createElement('SecureField', props),
    Text: (props: object) => React.createElement('Text', props),
    TextField: (props: object) => React.createElement('TextField', props),
    useNativeState: (initialValue: string) => React.useRef({ value: initialValue }).current,
  };
});

jest.mock('@expo/ui/swift-ui/modifiers', () => ({
  autocorrectionDisabled: () => ({ type: 'autocorrectionDisabled' }),
  font: () => ({ type: 'font' }),
  foregroundStyle: () => ({ type: 'foregroundStyle' }),
  listRowBackground: (value: string) => ({ type: 'listRowBackground', value }),
  disabled: (value: boolean) => ({ type: 'disabled', value }),
  keyboardType: (value: string) => ({ type: 'keyboardType', value }),
}));

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
  jest.mocked(loadRelayOverview).mockReset().mockResolvedValue(overview());
});
const builtInRows = (view: TestRenderer.ReactTestRenderer) =>
  view.root.findAllByType('SettingsNavRow' as never).filter((row) => row.props.readOnly);
const textOf = (view: TestRenderer.ReactTestRenderer) =>
  view.root.findAllByType('Text' as never).map((text) => text.children.join(''));

it('lists built-in relays as read-only rows with a localized name, address and source', async () => {
  jest.mocked(loadRelayOverview).mockResolvedValue(
    overview({
      entries: [
        builtInEntry('eu', 'https://eu.relay.example./'),
        builtInEntry('mars', 'https://mars.relay.example./'),
      ],
    })
  );
  let view!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    view = TestRenderer.create(<CustomRelaySection />);
  });
  try {
    const rows = builtInRows(view);
    expect(rows.map((row) => row.props.title)).toEqual(['relay.region.eu', 'https://mars.relay.example./']);
    expect(rows[0].props.subtitle).toContain('https://eu.relay.example./');
    expect(rows[0].props.value).toBe('relay.source.builtIn');
    expect(rows.every((row) => row.props.showsChevron === false && !row.props.onPress)).toBe(true);
  } finally {
    act(() => view.unmount());
  }
});

it('does not claim built-in relays are connected and reports a pending change as needing a full rebuild', async () => {
  jest.mocked(loadRelayOverview).mockResolvedValue(
    overview({
      savedMode: 'custom',
      changePending: true,
      entries: [builtInEntry('eu', 'https://eu.relay.example./')],
    })
  );
  let view!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    view = TestRenderer.create(<CustomRelaySection />);
  });
  try {
    const texts = textOf(view);
    expect(texts).toContain('relay.status.pending');
    expect(JSON.stringify(texts)).not.toMatch(/connected/i);
  } finally {
    act(() => view.unmount());
  }
});

it('shows a full-row retry when the overview cannot be loaded and recovers on retry', async () => {
  jest.useFakeTimers();
  jest.mocked(loadRelayOverview).mockRejectedValue(new Error('unavailable'));
  let view!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    view = TestRenderer.create(<CustomRelaySection />);
  });
  try {
    // The page retries quietly while Engine may still be starting before it shows the error row.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(OVERVIEW_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0));
    });
    const retry = view.root
      .findAllByType('SettingsNavRow' as never)
      .find((row) => row.props.testID === 'relay-overview-retry')!;
    expect(retry.props.title).toBe('relay.builtIn.loadFailed');
    expect(retry.props.readOnly).not.toBe(true);
    expect(retry.props.onPress).toEqual(expect.any(Function));
    jest.mocked(loadRelayOverview).mockResolvedValue(
      overview({ entries: [builtInEntry('eu', 'https://eu.relay.example./')] })
    );
    await act(async () => retry.props.onPress());
    expect(builtInRows(view).map((row) => row.props.title)).toEqual(['relay.region.eu']);
  } finally {
    act(() => view.unmount());
    jest.useRealTimers();
  }
});

it('says no node has started when Engine reports no applied mode', async () => {
  jest.mocked(loadRelayOverview).mockResolvedValue(
    overview({ appliedMode: null, entries: [builtInEntry('eu', 'https://eu.relay.example./', false)] })
  );
  let view!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    view = TestRenderer.create(<CustomRelaySection />);
  });
  try {
    expect(textOf(view)).toContain('relay.status.nodeNotStarted');
    expect(builtInRows(view)[0].props.subtitle).toContain(
      'relay.usage.notApplied'
    );
  } finally {
    act(() => view.unmount());
  }
});

it('reports add and edit taps to the parent instead of editing in place', async () => {
  jest.mocked(loadRelayOverview).mockResolvedValue(
    overview({ entries: [builtInEntry('eu', 'https://eu.relay.example./')] })
  );
  let view!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    view = TestRenderer.create(<CustomRelaySection />);
  });
  try {
    act(() =>
      view.root
        .findAllByType('SettingsNavRow' as never)
        .find((row) => row.props.testID === 'relay-add')!
        .props.onPress()
    );
    expect(onAddRelay).toHaveBeenCalledTimes(1);
    // No editor fields live on the list page; the editor is its own page.
    expect(view.root.findAllByType('TextField' as never)).toHaveLength(0);
  } finally {
    act(() => view.unmount());
  }
});
