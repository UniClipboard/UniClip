import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { UnifiedSpaceSetup } from '@/screens/settings/UnifiedSpaceSetup.android';
import { SpaceSettingsSection } from '@/screens/settings/android/SpaceSettingsSection';

const mockSpace: { spaceId: string | null; deviceName: string; status: string } = {
  spaceId: 'test-space',
  deviceName: 'Phone',
  status: 'ready',
};

const remoteDevice = {
  deviceId: 'remote-1',
  displayName: 'Laptop',
  isLocal: false,
  reachability: 'online',
  primaryStatus: 'usable',
};

const mockManagement = {
  devices: [] as (typeof remoteDevice)[],
  selectedDevice: null,
  overview: { primaryStatus: 'healthy', memberCount: 1 },
  highImpactActionsAvailable: true,
  operationInProgress: false,
  removing: false,
  closeDevice: jest.fn(),
  openDevice: jest.fn(),
};
const mockNavigation = {
  navigate: jest.fn(),
  setOptions: jest.fn(),
  canGoBack: () => true,
  goBack: jest.fn(),
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
  useUnifiedSpaceStore: () => mockSpace,
  getUnifiedSpaceService: () => ({ leaveSpace: jest.fn() }),
  UnifiedSpaceInputError: class UnifiedSpaceInputError extends Error {},
  spaceMaintenanceMessage: jest.requireActual('@/features/space/deviceTrustPresentation')
    .spaceMaintenanceMessage,
}));
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: { colors: { success: 'green' } } }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/components/android/M3IconButton', () => ({
  M3IconButton: () => null,
}));
jest.mock('@/components/AddSyncConnectionSheet', () => {
  const React = require('react');
  return {
    AddSyncConnectionSheet: ({ visible }: { visible: boolean }) => {
      const [phase, setPhase] = React.useState('invitation');
      return visible
        ? React.createElement('SetupSheet', { phase, startJoining: () => setPhase('joining') })
        : null;
    },
  };
});
jest.mock('@/components/SpaceInvitationSheet', () => ({
  SpaceInvitationSheet: () => null,
}));
jest.mock('@/components/SpaceDeviceDetail', () => ({
  SpaceDeviceDetail: () => null,
}));
jest.mock('@/screens/settings/CustomRelaySection', () => ({
  CustomRelaySection: () => null,
}));
jest.mock('@/screens/settings/android/SettingsLeadingIcon', () => ({
  SettingsLeadingIcon: () => null,
}));
jest.mock('@/screens/settings/SettingsSectionItem', () => ({
  SettingsSectionItem: ({
    children,
    dialogs,
  }: {
    children: React.ReactNode;
    dialogs?: React.ReactNode;
  }) => (
    <>
      {children}
      {dialogs}
    </>
  ),
  useSettingsSectionRowColors: () => undefined,
}));
jest.mock('@expo/ui/jetpack-compose', () => {
  const React = require('react');
  const slotted = (type: string, slots: string[]) =>
    Object.assign(
      (props: object) => React.createElement(type, props),
      Object.fromEntries(
        slots.map((name) => [name, ({ children }: { children: React.ReactNode }) => children])
      )
    );
  return {
    ...Object.fromEntries(
      [
        'Box',
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
    ListItem: slotted('ListItem', [
      'LeadingContent',
      'HeadlineContent',
      'SupportingContent',
      'TrailingContent',
    ]),
    AlertDialog: slotted('AlertDialog', ['Title', 'Text', 'ConfirmButton', 'DismissButton']),
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
jest.mock('@/assets/icons/check.xml', () => 1);
jest.mock('@/assets/icons/info.xml', () => 1);
jest.mock('@/assets/icons/devices.xml', () => 1);
jest.mock('@/assets/icons/smartphone.xml', () => 1);
jest.mock('@/assets/icons/settings.xml', () => 1);

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Modifier = { $type: string; eventListener?: () => void };

const rowWithText = (view: TestRenderer.ReactTestRenderer, label: string) =>
  view.root
    .findAllByType('ListItem' as never)
    .find((row) =>
      row.findAllByType('Text' as never).some((text) => text.props.children === label)
    )!;

const rowClick = (row: TestRenderer.ReactTestInstance) =>
  (row.props.modifiers as Modifier[]).find((modifier) => modifier.$type === 'clickable');

it('keeps native row modifiers valid as space settings actions become unavailable and available again', () => {
  let view: TestRenderer.ReactTestRenderer;
  act(() => {
    view = TestRenderer.create(<SpaceSettingsSection />);
  });
  try {
    for (const [index, busy] of [false, true, false].entries()) {
      mockManagement.operationInProgress = busy;
      // memo 页面无 props 变化,换 key 让它按新的管理状态重新渲染
      act(() => {
        view.update(<SpaceSettingsSection key={index} />);
      });
      for (const label of ['space.switch.title', 'space.leave.action']) {
        expect(Array.isArray(rowWithText(view, label).props.modifiers)).toBe(true);
        expect(Boolean(rowClick(rowWithText(view, label)))).toBe(!busy);
      }
    }
    act(() => rowClick(rowWithText(view, 'space.switch.title'))!.eventListener!());
    expect(view.root.findByType('SetupSheet' as never)).toBeTruthy();
  } finally {
    act(() => view.unmount());
    mockManagement.operationInProgress = false;
  }
});

it('makes whole device rows and the space settings row interactive on the devices page', () => {
  mockManagement.devices = [remoteDevice];
  mockNavigation.navigate.mockClear();
  mockManagement.openDevice.mockClear();
  let view: TestRenderer.ReactTestRenderer;
  act(() => {
    view = TestRenderer.create(<UnifiedSpaceSetup />);
  });
  try {
    // 点击绑定在整行 ListItem 上,而非行内文字或图标
    act(() => rowClick(rowWithText(view, 'Laptop'))!.eventListener!());
    expect(mockManagement.openDevice).toHaveBeenCalledWith('remote-1');

    // 低频管理项下沉到二级页,设备页只保留整行入口
    expect(rowWithText(view, 'space.leave.action')).toBeUndefined();
    expect(rowWithText(view, 'space.switch.title')).toBeUndefined();
    act(() => rowClick(rowWithText(view, 'space.settings.title'))!.eventListener!());
    expect(mockNavigation.navigate).toHaveBeenCalledWith('SettingsSub', {
      section: 'spaceSettings',
    });

    // 已加入空间时,刷新挂到所在页面的标题栏
    expect(mockNavigation.setOptions).toHaveBeenCalledWith(
      expect.objectContaining({ headerRight: expect.any(Function) })
    );
  } finally {
    act(() => view.unmount());
    mockManagement.devices = [];
  }
});

it('preserves an open join flow while the space changes from empty through loading to joined', () => {
  mockSpace.spaceId = null;
  let view: TestRenderer.ReactTestRenderer;
  act(() => {
    view = TestRenderer.create(<UnifiedSpaceSetup />);
  });
  try {
    act(() => view.root.findByType('FilledTonalButton' as never).props.onClick());
    act(() => view.root.findByType('SetupSheet' as never).props.startJoining());
    for (const [index, state] of [
      { spaceId: null, status: 'loading' },
      { spaceId: 'joined-space', status: 'ready' },
    ].entries()) {
      Object.assign(mockSpace, state);
      act(() => {
        view.update(<UnifiedSpaceSetup notificationNavigationRequestId={index} />);
      });
      expect(view.root.findByType('SetupSheet' as never).props.phase).toBe('joining');
    }
  } finally {
    act(() => view.unmount());
    Object.assign(mockSpace, { spaceId: 'test-space', status: 'ready' });
  }
});
