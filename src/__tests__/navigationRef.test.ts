import type { NavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/AppNavigator.types';
import { flushPendingNavigation, navigateWhenReady, navigationRef } from '../navigation/navigationRef';

describe('navigation readiness', () => {
  const navigate = jest.fn();
  let ready = false;

  beforeEach(() => {
    navigate.mockClear();
    ready = false;
    navigationRef.current = {
      isReady: () => ready,
      navigate,
    } as unknown as NavigationContainerRef<RootStackParamList>;
  });

  afterEach(() => {
    ready = true;
    flushPendingNavigation();
    navigationRef.current = null;
  });

  it('opens the requested screen with its parameters when ready', () => {
    ready = true;
    navigateWhenReady('SettingsSub', { section: 'lanServers' });
    expect(navigate).toHaveBeenCalledWith('SettingsSub', { section: 'lanServers' });
  });

  it('waits through startup and opens the queued screen exactly once', () => {
    navigateWhenReady('Settings', { section: 'space', deviceId: 'peer-1' });
    flushPendingNavigation();
    expect(navigate).not.toHaveBeenCalled();

    ready = true;
    flushPendingNavigation();
    flushPendingNavigation();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('Settings', { section: 'space', deviceId: 'peer-1' });
  });

  it('keeps the latest startup request, including screens without parameters', () => {
    navigationRef.current = null;
    navigateWhenReady('Settings', { section: 'lanServers' });
    navigateWhenReady('Main');
    expect(navigate).not.toHaveBeenCalled();

    navigationRef.current = {
      isReady: () => true,
      navigate,
    } as unknown as NavigationContainerRef<RootStackParamList>;
    flushPendingNavigation();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('Main');
  });
});
