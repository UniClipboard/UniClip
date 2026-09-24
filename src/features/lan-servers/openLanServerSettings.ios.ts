import { navigateWhenReady } from '@/navigation/navigationRef';

/** iOS: LAN servers live in the Devices tab (Standard sync). */
export function openLanServerSettings(): void {
  navigateWhenReady('Main', { screen: 'Devices' });
}
