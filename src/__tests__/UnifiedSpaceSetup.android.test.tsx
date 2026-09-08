import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { UnifiedSpaceSetup } from '@/screens/settings/UnifiedSpaceSetup.android';

const mockManagement = {
  devices: [],
  selectedDevice: null,
  overview: { primaryStatus: 'healthy', memberCount: 1 },
  highImpactActionsAvailable: true,
  operationInProgress: false,
  closeDevice: jest.fn(),
  openDevice: jest.fn(),
};
jest.mock('@/components/useSpaceDeviceManagement', () => ({
  useSpaceDeviceManagement: () => mockManagement,
}));
jest.mock('@/components/useSpacePageRefresh', () => ({
  useSpacePageRefresh: () => ({
    error: null,
    waiting: false,
    refresh: jest.fn(),
  }),
}));
jest.mock('@/features/space', () => ({
  useUnifiedSpaceStore: () => ({ spaceId: 'test-space', deviceName: 'Phone' }),
}));
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: { colors: { success: 'green' } } }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/components/AddSyncConnectionSheet', () => ({
  AddSyncConnectionSheet: () => null,
}));
jest.mock('@/components/SpaceInvitationSheet', () => ({
  SpaceInvitationSheet: () => null,
}));
jest.mock('@/components/SpaceDeviceDetail', () => ({
  SpaceDeviceDetail: () => null,
}));
jest.mock('@/screens/settings/CustomRelaySection', () => ({
  CustomRelaySection: () => null,
}));
jest.mock('@/screens/settings/SettingsSectionItem', () => ({
  SettingsSectionItem: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@expo/ui/jetpack-compose', () => {
  const React = require('react');
  const ListItem = Object.assign(
    (props: object) => React.createElement('ListItem', props),
    Object.fromEntries(
      ['LeadingContent', 'HeadlineContent', 'SupportingContent', 'TrailingContent'].map((name) => [
        name,
        ({ children }: { children: React.ReactNode }) => children,
      ])
    )
  );
  return {
    ...Object.fromEntries(
      [
        'Button',
        'CircularProgressIndicator',
        'Column',
        'FilledTonalButton',
        'HorizontalDivider',
        'Icon',
        'Row',
        'Spacer',
        'Surface',
        'Text',
        'TextButton',
      ].map((name) => [name, name])
    ),
    ListItem,
    Shape: { RoundedCorner: () => ({}) },
    useMaterialColors: () => ({}),
  };
});
jest.mock('@/assets/icons/add.xml', () => 1);
jest.mock('@/assets/icons/chevron_right.xml', () => 1);
jest.mock('@/assets/icons/delete.xml', () => 1);
jest.mock('@/assets/icons/account_circle.xml', () => 1);
jest.mock('@/assets/icons/groups.xml', () => 1);
jest.mock('@/assets/icons/circle.xml', () => 1);

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('keeps native row modifiers valid as space actions become unavailable and available again', () => {
  let view: TestRenderer.ReactTestRenderer;
  act(() => {
    view = TestRenderer.create(<UnifiedSpaceSetup />);
  });
  const actionRow = (label: string) =>
    view.root
      .findAllByType('ListItem' as never)
      .find((row) =>
        row.findAllByType('Text' as never).some((text) => text.props.children === label)
      )!;
  try {
    for (const busy of [false, true, false]) {
      mockManagement.operationInProgress = busy;
      act(() => {
        view.update(<UnifiedSpaceSetup notificationNavigationRequestId={Number(busy)} />);
      });
      for (const label of ['space.switch.title', 'space.leave.action']) {
        const modifiers = actionRow(label).props.modifiers;
        expect(Array.isArray(modifiers)).toBe(true);
        expect(
          modifiers.some((modifier: { $type: string }) => modifier.$type === 'clickable')
        ).toBe(!busy);
      }
    }
    act(() => actionRow('space.switch.title').props.modifiers[0].eventListener());
  } finally {
    act(() => view.unmount());
    mockManagement.operationInProgress = false;
  }
});
