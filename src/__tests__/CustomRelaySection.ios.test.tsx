import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { saveCustomRelay } from '@/features/relaySettings';
import { CustomRelaySection } from '@/screens/settings/CustomRelaySection.ios';

jest.mock('app-group-store', () => ({
  getEngineLogFileUris: () => [],
}));

jest.mock('@/features/relaySettings', () => ({
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
      updateConfig: jest.fn(),
    }),
}));

jest.mock('@/screens/settings/ios/common', () => {
  const React = require('react');
  return {
    SettingsNavRow: (props: object) => React.createElement('SettingsNavRow', props),
  };
});

jest.mock('@expo/ui/swift-ui', () => {
  const React = require('react');
  return {
    Button: (props: object) => React.createElement('Button', props),
    Section: (props: object) => React.createElement('Section', props),
    SecureField: (props: object) => React.createElement('SecureField', props),
    Text: (props: object) => React.createElement('Text', props),
    TextField: (props: object) => React.createElement('TextField', props),
    useNativeState: (initialValue: string) => React.useRef({ value: initialValue }).current,
  };
});

jest.mock('@expo/ui/swift-ui/modifiers', () => ({
  autocorrectionDisabled: () => ({ type: 'autocorrectionDisabled' }),
  disabled: (value: boolean) => ({ type: 'disabled', value }),
  keyboardType: (value: string) => ({ type: 'keyboardType', value }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('enables Save relay after an iOS user enters a relay address', () => {
  let view!: TestRenderer.ReactTestRenderer;
  act(() => {
    view = TestRenderer.create(<CustomRelaySection />);
  });

  try {
    act(() => view.root.findByType('SettingsNavRow' as never).props.onPress());
    expect(view.root.findAllByType('SecureField' as never)).toHaveLength(0);
    expect(
      view.root.findAllByType('TextField' as never).some(
        (field) => field.props.testID === 'relay-token-input'
      )
    ).toBe(true);
    const saveButton = () =>
      view.root
        .findAllByType('Button' as never)
        .find((button) => button.props.label === 'relay.save')!;
    const isDisabled = () =>
      saveButton().props.modifiers.some(
        (modifier: { type: string; value: boolean }) =>
          modifier.type === 'disabled' && modifier.value
      );

    expect(isDisabled()).toBe(true);
    act(() =>
      view.root
        .findAllByType('TextField' as never)
        .find((field) => field.props.testID === 'relay-url-input')!
        .props.onTextChange('https://relay.uni.z2blog.com')
    );
    expect(isDisabled()).toBe(false);
  } finally {
    act(() => view.unmount());
  }
});

it('keeps the editor open and shows a duplicate relay error', async () => {
  jest.mocked(saveCustomRelay).mockResolvedValue({
    relays: [],
    rejection: 'duplicate',
    connection: Promise.resolve('unchanged'),
  });
  let view!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    view = TestRenderer.create(<CustomRelaySection />);
  });

  try {
    act(() => view.root.findByType('SettingsNavRow' as never).props.onPress());
    act(() =>
      view.root
        .findAllByType('TextField' as never)
        .find((field) => field.props.testID === 'relay-url-input')!
        .props.onTextChange('https://relay.example.com')
    );
    await act(async () => {
      view.root
        .findAllByType('Button' as never)
        .find((button) => button.props.label === 'relay.save')!
        .props.onPress();
    });

    expect(
      view.root.findAllByType('TextField' as never).some(
        (field) => field.props.testID === 'relay-url-input'
      )
    ).toBe(true);
    expect(
      view.root.findAllByType('Text' as never).some((text) => text.children.includes('relay.error.duplicate'))
    ).toBe(true);
  } finally {
    act(() => view.unmount());
  }
});
