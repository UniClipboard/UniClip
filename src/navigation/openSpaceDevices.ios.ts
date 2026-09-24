import { navigateWhenReady } from './navigationRef';
import type { SpaceDeviceTarget } from './AppNavigator.types';

/** iOS: the space page is presented from Settings. */
export function openSpaceDevices(target: SpaceDeviceTarget): void {
  navigateWhenReady('Settings', { section: 'space', ...target });
}
