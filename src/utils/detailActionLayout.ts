import type { ActionMenuItem } from '@/utils/actionMenuItems';
import type { DisplayKind } from '@/utils/displayKind';

const QUICK_ACTION_KEYS: Record<DisplayKind, string[]> = {
  text: ['selectText', 'share'],
  url: ['openBrowser', 'share'],
  image: ['saveImage', 'share'],
  file: ['saveFile', 'share'],
  group: ['saveFile', 'share'],
};

const FALLBACK_QUICK_ACTION_KEYS = ['share', 'select'];

export interface DetailActionLayout {
  primary: ActionMenuItem | null;
  quick: ActionMenuItem[];
  overflow: ActionMenuItem[];
}

export function getDetailActionLayout(
  actions: ActionMenuItem[],
  displayKind: DisplayKind
): DetailActionLayout {
  const primary = actions.find((action) => action.key === 'copy') ?? null;
  const actionByKey = new Map(actions.map((action) => [action.key, action]));
  const quickKeys = [...QUICK_ACTION_KEYS[displayKind], ...FALLBACK_QUICK_ACTION_KEYS];
  const quick: ActionMenuItem[] = [];

  for (const key of quickKeys) {
    const action = actionByKey.get(key);
    if (action && !quick.some((candidate) => candidate.key === key)) {
      quick.push(action);
    }
    if (quick.length === 2) break;
  }

  const quickKeySet = new Set(quick.map((action) => action.key));
  const overflow = actions.filter(
    (action) => action.key !== primary?.key && !quickKeySet.has(action.key)
  );

  return { primary, quick, overflow };
}
