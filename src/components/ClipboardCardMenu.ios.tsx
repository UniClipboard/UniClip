import { useMemo } from 'react';
import { View, Text, Image, StyleSheet, useColorScheme } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Host } from '@expo/ui/swift-ui';
import { ContextMenu } from '@expo/ui/swift-ui';
import { Button, Divider } from '@expo/ui/swift-ui';
import { getDisplayKind, getDisplayKindColor, getURLDomain } from '@/utils/displayKind';
import { formatFileSize } from '@/utils/clipboard';
import type { ClipboardCardMenuProps } from './ClipboardCardMenu.types';

const PREVIEW_WIDTH = 340;

function CardPreview({ item, dk }: { item: ClipboardCardMenuProps['item']; dk: string }) {
  const isDark = useColorScheme() === 'dark';
  const textColor = isDark ? '#fff' : '#000';
  const secondaryColor = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)';
  const bg = isDark ? '#1c1c1e' : '#fff';

  switch (dk) {
    case 'text':
      return (
        <View style={[ps.container, { backgroundColor: bg }]}>
          <Text style={[ps.bodyText, { color: textColor }]} numberOfLines={18}>
            {item.text}
          </Text>
        </View>
      );

    case 'url': {
      const domain = getURLDomain(item.text);
      return (
        <View style={[ps.container, { backgroundColor: bg }]}>
          {domain ? (
            <Text style={[ps.headline, { color: textColor }]} numberOfLines={1}>
              {domain}
            </Text>
          ) : null}
          <Text style={[ps.urlText, { color: '#007AFF' }]} numberOfLines={4}>
            {item.text}
          </Text>
        </View>
      );
    }

    case 'image': {
      const hasImage = item.isLocalFileReady && item.fileUri;
      return (
        <View style={[ps.imageContainer, { backgroundColor: bg }]}>
          {hasImage ? (
            <Image
              source={{ uri: item.fileUri }}
              style={ps.image}
              resizeMode="contain"
            />
          ) : (
            <Ionicons name="image" size={48} color={secondaryColor} />
          )}
        </View>
      );
    }

    case 'file':
    case 'group': {
      const kindColor = getDisplayKindColor(dk as any);
      return (
        <View style={[ps.fileContainer, { backgroundColor: bg }]}>
          <Ionicons
            name={dk === 'group' ? 'folder' : 'document'}
            size={48}
            color={kindColor}
          />
          <Text style={[ps.headline, { color: textColor }]} numberOfLines={2}>
            {item.dataName || item.text}
          </Text>
          {item.size ? (
            <Text style={[ps.subText, { color: secondaryColor }]}>
              {formatFileSize(item.size)}
            </Text>
          ) : null}
        </View>
      );
    }

    default:
      return (
        <View style={[ps.container, { backgroundColor: bg }]}>
          <Text style={{ color: textColor }}>{item.text}</Text>
        </View>
      );
  }
}

export function ClipboardCardMenu({ item, cardSize, onAction, children }: ClipboardCardMenuProps) {
  const dk = useMemo(() => getDisplayKind(item.type, item.text), [item.type, item.text]);

  return (
    <Host style={{ width: cardSize, height: cardSize }}>
      <ContextMenu>
        <ContextMenu.Trigger>
          {children}
        </ContextMenu.Trigger>
        <ContextMenu.Preview>
          <CardPreview item={item} dk={dk} />
        </ContextMenu.Preview>
        <ContextMenu.Items>
          <Button label="复制" systemImage="doc.on.doc" onPress={() => onAction('copy')} />
          {(dk === 'text' || dk === 'url') && (
            <Button label="选择文本" systemImage="selection.pin.in.out" onPress={() => onAction('selectText')} />
          )}
          {(dk === 'text' || dk === 'url') && (
            <Button label="复制为纯文本" systemImage="doc.plaintext" onPress={() => onAction('copyPlain')} />
          )}
          {dk === 'url' && (
            <Button label="在浏览器中打开" systemImage="safari" onPress={() => onAction('openBrowser')} />
          )}
          {dk === 'image' && item.isLocalFileReady && item.fileUri && (
            <Button label="保存图片" systemImage="square.and.arrow.down" onPress={() => onAction('saveImage')} />
          )}
          {(dk === 'file' || dk === 'group') && item.isLocalFileReady && item.fileUri && (
            <Button label="保存文件" systemImage="folder" onPress={() => onAction('saveFile')} />
          )}
          <Button label="分享" systemImage="square.and.arrow.up" onPress={() => onAction('share')} />
          <Divider />
          <Button label="选择" systemImage="checkmark.circle" onPress={() => onAction('select')} />
          <Button label="删除" systemImage="trash" role="destructive" onPress={() => onAction('delete')} />
        </ContextMenu.Items>
      </ContextMenu>
    </Host>
  );
}

const ps = StyleSheet.create({
  container: {
    width: PREVIEW_WIDTH,
    padding: 16,
  },
  bodyText: {
    fontSize: 17,
    lineHeight: 24,
  },
  headline: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 4,
  },
  urlText: {
    fontSize: 15,
    lineHeight: 22,
  },
  subText: {
    fontSize: 14,
    marginTop: 4,
  },
  imageContainer: {
    width: PREVIEW_WIDTH,
    minHeight: 220,
    maxHeight: 460,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: PREVIEW_WIDTH,
    height: 340,
  },
  fileContainer: {
    width: PREVIEW_WIDTH,
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
});
