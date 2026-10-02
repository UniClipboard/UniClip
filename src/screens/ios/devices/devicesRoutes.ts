/**
 * Pages pushed on the iOS Devices tab's NavigationStack, with the page each one sits on.
 * The stack is always derived from this table, so a page can never be pushed without its
 * ancestors and one back gesture always returns exactly one level up.
 */
export type DevicesRoute = 'spaceSettings' | 'relay' | 'relayEditor';

const PARENT: Record<DevicesRoute, DevicesRoute | null> = {
  spaceSettings: null,
  relay: 'spaceSettings',
  relayEditor: 'relay',
};

/** The full stack, root first, that shows `route` on top. */
export function devicesRoutePath(route: DevicesRoute): DevicesRoute[] {
  const path: DevicesRoute[] = [];
  for (let current: DevicesRoute | null = route; current; current = PARENT[current]) {
    path.unshift(current);
  }
  return path;
}
