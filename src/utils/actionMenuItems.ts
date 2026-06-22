import type { ClipboardItem } from '@/types/clipboard';
import type { DisplayKind } from '@/utils/displayKind';

export interface ActionMenuItem {
  key: string;
  label: string;
  icon: string;
  destructive?: boolean;
  onPress: () => void;
}

interface ActionHandlers {
  onCopy: () => void;
  onSelectText: () => void;
  onCopyPlainText: () => void;
  onOpenInBrowser: () => void;
  onSaveImage: () => void;
  onSaveFile: () => void;
  onShare: () => void;
  onSelect: () => void;
  onDelete: () => void;
}

export function buildActionMenuItems(
  item: ClipboardItem,
  displayKind: DisplayKind,
  handlers: ActionHandlers
): ActionMenuItem[] {
  const items: ActionMenuItem[] = [];

  items.push({ key: 'copy', label: '复制', icon: 'copy-outline', onPress: handlers.onCopy });

  if (displayKind === 'text' || displayKind === 'url') {
    items.push({ key: 'selectText', label: '选择文本', icon: 'text-outline', onPress: handlers.onSelectText });
    items.push({ key: 'copyPlain', label: '复制为纯文本', icon: 'clipboard-outline', onPress: handlers.onCopyPlainText });
  }

  if (displayKind === 'url') {
    items.push({ key: 'openBrowser', label: '在浏览器中打开', icon: 'open-outline', onPress: handlers.onOpenInBrowser });
  }

  if (displayKind === 'image' && item.isLocalFileReady && item.fileUri) {
    items.push({ key: 'saveImage', label: '保存图片', icon: 'download-outline', onPress: handlers.onSaveImage });
  }

  if ((displayKind === 'file' || displayKind === 'group') && item.isLocalFileReady && item.fileUri) {
    items.push({ key: 'saveFile', label: '保存文件', icon: 'download-outline', onPress: handlers.onSaveFile });
  }

  items.push({ key: 'share', label: '分享', icon: 'share-outline', onPress: handlers.onShare });

  items.push({ key: 'divider', label: '', icon: '', onPress: () => {} });

  items.push({ key: 'select', label: '选择', icon: 'checkmark-circle-outline', onPress: handlers.onSelect });
  items.push({ key: 'delete', label: '删除', icon: 'trash-outline', destructive: true, onPress: handlers.onDelete });

  return items;
}
