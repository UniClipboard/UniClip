import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockSetNativeValue = jest.fn();

jest.mock('@expo/ui/jetpack-compose', () => {
  const react = require('react') as typeof import('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    react.createElement(react.Fragment, null, children);
  const OutlinedTextField = Object.assign(passthrough, { Label: passthrough });
  const DropdownMenuItem = Object.assign(passthrough, { Text: passthrough });

  return {
    ExposedDropdownMenuBox: passthrough,
    ExposedDropdownMenu: passthrough,
    DropdownMenuItem,
    OutlinedTextField,
    Text: passthrough,
    useNativeState: (initialValue: string) => {
      const state = react.useRef({ value: initialValue, set: mockSetNativeValue });
      return state.current;
    },
  };
});

jest.mock('@expo/ui/jetpack-compose/modifiers', () => ({
  menuAnchor: () => ({}),
  fillMaxWidth: () => ({}),
  width: () => ({}),
}));

import { AppDropdown } from '../components/ui/AppDropdown.android';

const options = [
  { label: 'Follow system', value: 'system' },
  { label: 'English', value: 'en' },
];

describe('AppDropdown Android', () => {
  beforeEach(() => jest.clearAllMocks());

  it('updates the native field when the selected option changes', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <AppDropdown options={options} selectedValue="system" onSelect={jest.fn()} />
      );
    });

    act(() => {
      renderer.update(<AppDropdown options={options} selectedValue="en" onSelect={jest.fn()} />);
    });

    expect(mockSetNativeValue).toHaveBeenLastCalledWith('English');
  });
});
