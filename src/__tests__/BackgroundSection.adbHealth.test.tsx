import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { setImmediate } from 'node:timers';
import type { ClipboardMonitorStatus } from 'clipboard-overlay';
import { BackgroundSection } from '@/screens/settings/android/BackgroundSection';

const mockRestart = jest.fn<Promise<void>, []>();
const mockToast = jest.fn();
const mockResume = jest.fn();
const mockConfigUpdate = jest.fn();
let mockStatus: ClipboardMonitorStatus;
let mockStatusListener: (status: ClipboardMonitorStatus) => void = () => {};
const mockSettings = {
  config: { clipboardAccessMethod: 'overlay-event', enableBackgroundTasks: true },
  isTempDisabledBackgroundTasks: false,
  setTempDisabledBackgroundTasks: mockResume,
  updateConfig: mockConfigUpdate,
};

jest.mock('@/stores', () => ({
  useClipboardStore: { getState: () => ({ restartMonitoring: mockRestart }) },
  useSettingsStore: Object.assign(
    <T,>(selector: (state: typeof mockSettings) => T) => selector(mockSettings),
    { getState: () => mockSettings }
  ),
}));
jest.mock('@/utils/androidBackgroundClipboardAccess', () => ({
  getClipboardAccessAdapter: () => ({
    getAuthorizationState: () => ({ status: 'ready', monitoringStatus: 'ready' }),
    addAuthorizationChangeListener: () => ({ remove: jest.fn() }),
    getMonitorStatus: () => mockStatus,
    addMonitorStatusListener: (listener: typeof mockStatusListener) => {
      mockStatusListener = listener;
      return { remove: jest.fn() };
    },
    activate: async () => {},
  }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: jest.fn() }) },
  Linking: {},
  PermissionsAndroid: { check: async () => true, PERMISSIONS: { POST_NOTIFICATIONS: 'notifications' } },
}));
jest.mock('@expo/ui/jetpack-compose', () => {
  const React = require('react');
  return {
    Column: 'Column', Spacer: 'Spacer', TextButton: 'TextButton', Text: 'Text',
    AlertDialog: Object.assign((props: { children: React.ReactNode }) =>
      React.createElement('dialog', props, props.children), {
      Title: 'DialogTitle', Text: 'DialogText', ConfirmButton: 'DialogConfirm', DismissButton: 'DialogDismiss',
    }),
  };
});
jest.mock('@expo/ui/jetpack-compose/modifiers', () => ({ fillMaxWidth: () => ({}), height: () => ({}) }));
jest.mock('android-util', () => ({ isIgnoringBatteryOptimizations: () => true }));
jest.mock('@/screens/settings/SettingsToastContext', () => ({ useSettingsToast: () => mockToast }));
jest.mock('@/screens/settings/ClipboardAccessMethodSheet', () => ({ useClipboardAccessMethodSheet: () => ({}) }));
jest.mock('@/screens/settings/android/useSmsCodeAutoCopy', () => ({
  useSmsCodeAutoCopy: () => ({ enabled: false, toggle: jest.fn() }),
}));
jest.mock('@/screens/settings/android/SettingsHeroCard', () => ({ SettingsHeroCard: 'HeroCard' }));
jest.mock('@/screens/settings/android/SettingsListRow', () => ({ SettingsListRow: 'SettingsListRow' }));
jest.mock('@/screens/settings/android/SettingsSwitchRow', () => ({ SettingsSwitchRow: 'SettingsSwitchRow' }));
jest.mock('@/screens/settings/SettingsSectionItem', () => {
  const React = require('react');
  return { SettingsSectionItem: (props: { children: React.ReactNode; dialogs?: React.ReactNode }) =>
    React.createElement('SettingsSectionItem', props, props.children, props.dialogs) };
});
jest.mock('@/assets/icons/terminal.xml', () => 1);
jest.mock('@/assets/icons/error.xml', () => 2);
jest.mock('@/assets/icons/check.xml', () => 3);

async function mount() {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<BackgroundSection />); });
  return renderer;
}

describe('ADB reader health in Android background settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRestart.mockResolvedValue();
    mockSettings.config.enableBackgroundTasks = true;
    mockSettings.isTempDisabledBackgroundTasks = false;
    mockConfigUpdate.mockResolvedValue({ ok: true });
    mockStatus = {
      state: 'listening', generation: 1, attempt: 1, lastEventAtMs: null,
      reason: null, exitCode: null, detail: null, retryInMs: null,
    };
  });

  it('distinguishes permissions from listening and updates failure without a restart loop', async () => {
    const renderer = await mount();
    const permission = renderer.root.findByProps({ testID: 'background-clipboard-access-ready' });
    expect(permission.props.title).toBe('advanced.clipboardAccess.monitor.permissionReady');
    let reader = renderer.root.findByProps({ testID: 'background-adb-monitor-status' });
    expect(reader.props.description).toBe('advanced.clipboardAccess.monitor.status.listening');
    await act(async () => { mockStatusListener({ ...mockStatus, state: 'failed', exitCode: 1 }); });
    reader = renderer.root.findByProps({ testID: 'background-adb-monitor-status' });
    expect(reader.props.tone).toBe('warning');
    expect(reader.props.description).toBe('advanced.clipboardAccess.monitor.status.failed');
    expect(mockRestart).not.toHaveBeenCalled();
    await act(async () => { renderer.unmount(); });
  });

  it('restarts from the entire status row without claiming successful background reading', async () => {
    const renderer = await mount();
    const reader = renderer.root.findByProps({ testID: 'background-adb-monitor-status' });
    await act(async () => { reader.props.onPress(); await new Promise(setImmediate); });
    expect(mockRestart).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith('advanced.clipboardAccess.monitor.restartRequested', 'success');
    expect(mockToast).not.toHaveBeenCalledWith('advanced.clipboardAccess.setup.completed', 'success');
    await act(async () => { renderer.unmount(); });
  });

  it('restores the event reader when resuming temporarily paused background sync', async () => {
    mockSettings.isTempDisabledBackgroundTasks = true;
    const renderer = await mount();
    await act(async () => {
      renderer.root.findByProps({ testID: 'background-tasks' }).props.onValueChange(true);
      await new Promise(setImmediate);
    });
    expect(mockResume).toHaveBeenCalledWith(false);
    expect(mockRestart).toHaveBeenCalledTimes(1);
    await act(async () => { renderer.unmount(); });
  });

  it('starts the event reader after enabling background sync and checking permissions', async () => {
    mockSettings.config.enableBackgroundTasks = false;
    const renderer = await mount();
    await act(async () => {
      renderer.root.findByProps({ testID: 'background-tasks' }).props.onValueChange(true);
    });
    await act(async () => {
      const confirm = renderer.root.findAllByType('TextButton').find((button) =>
        button.findAllByType('Text').some((text) => text.children.includes('dialog.enableAutoSync.confirm'))
      );
      expect(confirm).toBeDefined();
      confirm!.props.onClick();
      await new Promise(setImmediate);
    });
    expect(mockConfigUpdate).toHaveBeenCalledWith(expect.objectContaining({ enableBackgroundTasks: true }));
    expect(mockRestart).toHaveBeenCalledTimes(1);
    await act(async () => { renderer.unmount(); });
  });
});
