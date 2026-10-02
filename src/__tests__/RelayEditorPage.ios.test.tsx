import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { loadRelayOverview, saveCustomRelay } from '@/features/relaySettings';
import type { RelayOverview } from '@/features/relayOverview';
import { RelayEditorPage } from '@/screens/ios/devices/RelayEditorPage';
import { useCustomRelaySettings } from '@/screens/settings/useCustomRelaySettings';

const onClose = jest.fn();
function Editor({ editingUrl = '' }: { editingUrl?: string }) {
  const relay = useCustomRelaySettings();
  return <RelayEditorPage relay={relay} editingUrl={editingUrl} onClose={onClose} />;
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
  textInputAutocapitalization: (value: string) => ({ type: 'autocapitalization', value }),
  keyboardType: (value: string) => ({ type: 'keyboardType', value }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

beforeEach(() => {
  onClose.mockClear();
  jest.mocked(saveCustomRelay).mockReset();
});

const field = (view: TestRenderer.ReactTestRenderer, id: string) =>
  view.root.findAllByType('TextField' as never).find((f) => f.props.testID === id)!;
const saveButton = (view: TestRenderer.ReactTestRenderer) =>
  view.root.findAllByType('Button' as never).find((b) => b.props.label === 'relay.save')!;
const isDisabled = (button: TestRenderer.ReactTestInstance) =>
  button.props.modifiers.some(
    (modifier: { type: string; value: boolean }) => modifier.type === 'disabled' && modifier.value
  );

it('enables Save relay after the user enters a relay address, without a password field', () => {
  let view!: TestRenderer.ReactTestRenderer;
  act(() => {
    view = TestRenderer.create(<Editor />);
  });
  try {
    expect(view.root.findAllByType('SecureField' as never)).toHaveLength(0);
    expect(field(view, 'relay-token-input')).toBeDefined();
    expect(isDisabled(saveButton(view))).toBe(true);
    act(() => field(view, 'relay-url-input').props.onTextChange('https://relay.uni.z2blog.com'));
    expect(isDisabled(saveButton(view))).toBe(false);
  } finally {
    act(() => view.unmount());
  }
});

it('stays on the editor and shows a duplicate relay error', async () => {
  jest.mocked(saveCustomRelay).mockResolvedValue({
    relays: [],
    rejection: 'duplicate',
    connection: Promise.resolve('unchanged'),
  });
  let view!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    view = TestRenderer.create(<Editor />);
  });
  try {
    act(() => field(view, 'relay-url-input').props.onTextChange('https://relay.example.com'));
    await act(async () => saveButton(view).props.onPress());
    expect(onClose).not.toHaveBeenCalled();
    expect(
      view.root.findAllByType('Text' as never).some((text) => text.children.includes('relay.error.duplicate'))
    ).toBe(true);
  } finally {
    act(() => view.unmount());
  }
});

it('returns to the relay page after a successful save and offers removal when editing', async () => {
  jest.mocked(saveCustomRelay).mockResolvedValue({
    relays: [],
    connection: Promise.resolve('rebuilt'),
  });
  let view!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    view = TestRenderer.create(<Editor editingUrl="https://mine.example.com" />);
  });
  try {
    expect(field(view, 'relay-url-input')).toBeDefined();
    const remove = view.root
      .findAllByType('Button' as never)
      .find((b) => b.props.label === 'relay.remove')!;
    await act(async () => remove.props.onPress());
    expect(saveCustomRelay).toHaveBeenCalledWith(
      expect.objectContaining({ url: '', previousUrl: 'https://mine.example.com' })
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  } finally {
    act(() => view.unmount());
  }
});
