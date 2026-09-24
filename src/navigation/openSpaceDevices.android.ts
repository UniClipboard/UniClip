import { navigateWhenReady } from './navigationRef';
import type { SpaceDeviceTarget } from './AppNavigator.types';

/** Android: space devices live in the top-level Devices destination. */
export function openSpaceDevices(target: SpaceDeviceTarget): void {
  navigateWhenReady('Main', { screen: 'Devices', params: target });
}
