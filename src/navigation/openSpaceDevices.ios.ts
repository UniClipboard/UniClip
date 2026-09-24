import { navigateWhenReady } from './navigationRef';
import type { SpaceDeviceTarget } from './AppNavigator.types';

/** iOS: space devices live in the top-level Devices tab. */
export function openSpaceDevices(target: SpaceDeviceTarget): void {
  navigateWhenReady('Main', { screen: 'Devices', params: target });
}
