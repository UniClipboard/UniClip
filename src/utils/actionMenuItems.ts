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

/**
 * 卡片长按菜单的动作描述，平台无关（不含 handler、不含图标——两个平台的图标
 * 分别在各自的渲染层按 key 映射）。Android 与 iOS 的 ActionSheet 共用同一份
 * "哪些动作对哪种 displayKind 可见"的判定，避免两处平台实现各自维护一份条件分支。
 */
export interface CardActionDescriptor {
  key: string;
  label: string;
  androidIcon: string;
  destructive?: boolean;
}

export function getClipboardCardActionDescriptors(
  item: ClipboardItem,
  displayKind: DisplayKind
): CardActionDescriptor[] {
  const descriptors: CardActionDescriptor[] = [];

  descriptors.push({ key: 'copy', label: '复制', androidIcon: 'copy-outline' });

  if (displayKind === 'text' || displayKind === 'url') {
    descriptors.push({ key: 'selectText', label: '选择文本', androidIcon: 'text-outline' });
    descriptors.push({ key: 'copyPlain', label: '复制为纯文本', androidIcon: 'clipboard-outline' });
  }

  if (displayKind === 'url') {
    descriptors.push({ key: 'openBrowser', label: '在浏览器中打开', androidIcon: 'open-outline' });
  }

  if (displayKind === 'image' && item.isLocalFileReady && item.fileUri) {
    descriptors.push({ key: 'saveImage', label: '保存图片', androidIcon: 'download-outline' });
  }

  if (
    (displayKind === 'file' || displayKind === 'group') &&
    item.isLocalFileReady &&
    item.fileUri
  ) {
    descriptors.push({ key: 'saveFile', label: '保存文件', androidIcon: 'download-outline' });
  }

  descriptors.push({ key: 'share', label: '分享', androidIcon: 'share-outline' });
  descriptors.push({ key: 'select', label: '选择', androidIcon: 'checkmark-circle-outline' });
  descriptors.push({
    key: 'delete',
    label: '删除',
    androidIcon: 'trash-outline',
    destructive: true,
  });

  return descriptors;
}

export function buildActionMenuItems(
  item: ClipboardItem,
  displayKind: DisplayKind,
  handlers: ActionHandlers
): ActionMenuItem[] {
  const handlerByKey: Record<string, () => void> = {
    copy: handlers.onCopy,
    selectText: handlers.onSelectText,
    copyPlain: handlers.onCopyPlainText,
    openBrowser: handlers.onOpenInBrowser,
    saveImage: handlers.onSaveImage,
    saveFile: handlers.onSaveFile,
    share: handlers.onShare,
    select: handlers.onSelect,
    delete: handlers.onDelete,
  };

  const items: ActionMenuItem[] = getClipboardCardActionDescriptors(item, displayKind).map((d) => ({
    key: d.key,
    label: d.label,
    icon: d.androidIcon,
    destructive: d.destructive,
    onPress: handlerByKey[d.key],
  }));

  const selectIndex = items.findIndex((i) => i.key === 'select');
  items.splice(selectIndex, 0, { key: 'divider', label: '', icon: '', onPress: () => {} });

  return items;
}
