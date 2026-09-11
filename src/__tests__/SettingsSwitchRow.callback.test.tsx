import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { SettingsSwitchRow } from '../screens/settings/android/SettingsSwitchRow';
jest.mock('@expo/ui/jetpack-compose', () => {
  const React = require('react');
  return { ListItem: Object.assign((props: object) => React.createElement('row', props), { HeadlineContent: 'headline', SupportingContent: 'support', TrailingContent: 'trailing' }), Switch: 'switch', Text: 'text' };
});
jest.mock('@expo/ui/jetpack-compose/modifiers', () => ({ toggleable: (value: boolean, handler: () => void) => ({value, handler}), testID: (id: string) => ({id}) }));
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
it('row and switch taps both change the value, while disabled controls do nothing', async () => {
 const change = jest.fn();
 let renderer!: TestRenderer.ReactTestRenderer;
 await act(async () => {renderer = TestRenderer.create(<SettingsSwitchRow title="Capture" value={false} onValueChange={change} />);});
 renderer.root.findByType('row' as React.ElementType).props.modifiers[0].handler();
 expect(change).toHaveBeenLastCalledWith(true);
 await act(async () => {renderer.update(<SettingsSwitchRow title="Capture" value onValueChange={change} />);});
 const thumb = renderer.root.findByType('switch' as React.ElementType);
 expect(thumb.props.onCheckedChange).toEqual(expect.any(Function));
 thumb.props.onCheckedChange(false);
 expect(change).toHaveBeenLastCalledWith(false);
 change.mockClear();
 await act(async () => {renderer.update(<SettingsSwitchRow title="Capture" value disabled onValueChange={change} />);});
 renderer.root.findByType('row' as React.ElementType).props.modifiers[0].handler();
 renderer.root.findByType('switch' as React.ElementType).props.onCheckedChange(false);
 expect(change).not.toHaveBeenCalled();
 await act(async () => {renderer.unmount();});
});
