import type { ClipboardContentType } from '@/types/api';

export type DisplayKind = 'text' | 'url' | 'image' | 'file' | 'group';

export function getDisplayKind(type: ClipboardContentType, text: string): DisplayKind {
  switch (type) {
    case 'Image':
      return 'image';
    case 'File':
      return 'file';
    case 'Group':
      return 'group';
    case 'Text':
    default:
      return isURL(text) ? 'url' : 'text';
  }
}

function isURL(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.includes('\n')) return false;
  try {
    const url = new URL(trimmed);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname;
  } catch {
    return false;
  }
}

export function getDisplayKindLabel(kind: DisplayKind): string {
  const labels: Record<DisplayKind, string> = {
    text: '文本',
    url: '链接',
    image: '图片',
    file: '文件',
    group: '归档',
  };
  return labels[kind];
}

export function getDisplayKindIcon(kind: DisplayKind): string {
  const icons: Record<DisplayKind, string> = {
    text: 'document-text',
    url: 'link',
    image: 'image',
    file: 'document',
    group: 'folder',
  };
  return icons[kind];
}

export function getDisplayKindColor(kind: DisplayKind): string {
  const colors: Record<DisplayKind, string> = {
    text: '#4285F4',
    url: '#00BCD4',
    image: '#4CAF50',
    file: '#FF9800',
    group: '#9C27B0',
  };
  return colors[kind];
}

export function getURLDomain(text: string): string {
  try {
    return new URL(text.trim()).hostname;
  } catch {
    return text.trim();
  }
}

export function getURLWithoutScheme(text: string): string {
  const trimmed = text.trim();
  const idx = trimmed.indexOf('://');
  return idx >= 0 ? trimmed.slice(idx + 3) : trimmed;
}

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 5000) return '刚刚';
  if (diff < 60000) return `${Math.floor(diff / 1000)}秒前`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;
  const d = new Date(timestamp);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
