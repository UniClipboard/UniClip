import type { ClipboardItem } from '@/types/clipboard';
import type { DisplayKind } from '@/utils/displayKind';
import type { ActionMenuItem } from '@/utils/actionMenuItems';

export interface ClipboardCardActionSheetProps {
  visible: boolean;
  item: ClipboardItem | null;
  displayKind: DisplayKind | null;
  onDismiss: () => void;
  actions: ActionMenuItem[];
}
