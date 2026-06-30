import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Image, Pressable, Platform } from 'react-native';
import Svg, {
  Defs,
  LinearGradient as SvgLinearGradient,
  Stop,
  Rect as SvgRect,
  Pattern as SvgPattern,
} from 'react-native-svg';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ArrowDown, ArrowUp } from 'lucide-react-native';
import { useTheme } from '@/hooks/useTheme';
import { useURLMetadata } from '@/hooks/useURLMetadata';
import { ClipboardItem } from '@/types/clipboard';
import { iosColors, iosCardShadow, iosDimensions } from '@/theme/iosDesignTokens';
import {
  getDisplayKind,
  getDisplayKindLabel,
  getDisplayKindColor,
  getURLDomain,
  getURLWithoutScheme,
  formatRelativeTime,
  type DisplayKind,
} from '@/utils/displayKind';
import { getHistoryDirectionIndicator } from '@/utils/historyDirection';

interface ClipboardCardProps {
  item: ClipboardItem;
  isLatest: boolean;
  isSelected?: boolean;
  isSelectMode?: boolean;
  onPress: (item: ClipboardItem) => void;
  onLongPress?: (item: ClipboardItem) => void;
  cardSize: number;
}

export const ClipboardCard: React.FC<ClipboardCardProps> = React.memo(
  ({ item, isLatest, isSelected, isSelectMode, onPress, onLongPress, cardSize }) => {
    const { theme } = useTheme();
    const displayKind = useMemo(() => getDisplayKind(item.type, item.text), [item.type, item.text]);
    const kindLabel = useMemo(() => getDisplayKindLabel(displayKind), [displayKind]);
    const kindColor = useMemo(() => getDisplayKindColor(displayKind), [displayKind]);
    const relativeTime = formatRelativeTime(item.timestamp);

    return (
      <Pressable
        onPress={() => onPress(item)}
        onLongPress={() => onLongPress?.(item)}
        style={({ pressed }) => [
          styles.card,
          Platform.OS === 'ios' && styles.cardIOS,
          {
            width: cardSize,
            height: cardSize,
            backgroundColor: iosColors?.secondarySystemGroupedBackground ?? theme.colors.surfaceContainerLow,
            borderColor: isSelected ? theme.colors.primary : 'transparent',
            borderWidth: isSelected ? 2 : 0,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <CardBody
          item={item}
          displayKind={displayKind}
          kindLabel={kindLabel}
          kindColor={kindColor}
          relativeTime={relativeTime}
          isLatest={isLatest}
          theme={theme}
        />
        {isSelectMode && (
          <View style={styles.selectOverlay}>
            <Ionicons
              name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
              size={28}
              color={isSelected ? theme.colors.primary : 'rgba(128,128,128,0.6)'}
            />
          </View>
        )}
      </Pressable>
    );
  }
);

interface CardBodyProps {
  item: ClipboardItem;
  displayKind: DisplayKind;
  kindLabel: string;
  kindColor: string;
  relativeTime: string;
  isLatest: boolean;
  theme: ReturnType<typeof useTheme>['theme'];
}

function CardBody({
  item,
  displayKind,
  kindLabel,
  kindColor,
  relativeTime,
  isLatest,
  theme,
}: CardBodyProps) {
  switch (displayKind) {
    case 'image':
      return (
        <ImageCardBody
          item={item}
          kindLabel={kindLabel}
          relativeTime={relativeTime}
          isLatest={isLatest}
          theme={theme}
        />
      );
    case 'url':
      return (
        <URLCardBody
          item={item}
          kindLabel={kindLabel}
          kindColor={kindColor}
          relativeTime={relativeTime}
          isLatest={isLatest}
          theme={theme}
        />
      );
    default:
      return (
        <StandardCardBody
          item={item}
          displayKind={displayKind}
          kindLabel={kindLabel}
          kindColor={kindColor}
          relativeTime={relativeTime}
          isLatest={isLatest}
          theme={theme}
        />
      );
  }
}

function HeaderRow({
  kindLabel,
  relativeTime,
  overlay,
  theme,
}: {
  kindLabel: string;
  relativeTime: string;
  overlay?: boolean;
  theme: CardBodyProps['theme'];
}) {
  return (
    <View style={styles.headerRow}>
      <Text
        style={[
          styles.kindLabel,
          { color: overlay ? '#fff' : theme.colors.onSurfaceVariant },
          overlay && styles.kindLabelOverlay,
        ]}
      >
        {kindLabel}
      </Text>
      <Text
        style={[
          styles.timeLabel,
          { color: overlay ? 'rgba(255,255,255,0.8)' : theme.colors.outline },
        ]}
      >
        {relativeTime}
      </Text>
    </View>
  );
}

function BottomRow({
  item,
  isLatest,
  overlay,
  theme,
}: {
  item: ClipboardItem;
  isLatest: boolean;
  overlay?: boolean;
  theme: CardBodyProps['theme'];
}) {
  const dirColor = overlay ? 'rgba(255,255,255,0.7)' : theme.colors.onSurfaceVariant;
  const indicator = getHistoryDirectionIndicator(item);
  return (
    <View style={styles.bottomRow}>
      {indicator === 'download' ? (
        <ArrowDown size={10} color={dirColor} />
      ) : indicator === 'pendingUpload' || indicator === 'pendingSync' ? (
        <Ionicons name="time-outline" size={10} color={dirColor} />
      ) : (
        <ArrowUp size={10} color={dirColor} />
      )}
      <View style={styles.bottomSpacer} />
      {isLatest && (
        <View
          style={[
            styles.latestDot,
            { backgroundColor: overlay ? '#fff' : theme.colors.primary },
          ]}
        />
      )}
    </View>
  );
}

function GradientScrim({
  direction,
  opacity,
  style,
}: {
  direction: 'down' | 'up';
  opacity: number;
  style: any;
}) {
  const id = direction === 'down' ? 'scrimDown' : 'scrimUp';
  return (
    <View style={style} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <SvgLinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop
              offset="0"
              stopColor="black"
              stopOpacity={direction === 'down' ? opacity : 0}
            />
            <Stop
              offset="1"
              stopColor="black"
              stopOpacity={direction === 'down' ? 0 : opacity}
            />
          </SvgLinearGradient>
        </Defs>
        <SvgRect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

const CHECKER_CELL = 16;

// 透明区域棋盘格背景。用单个 SVG Pattern 平铺，替代 12×12=144 个 RN View，
// 每张图片卡片只产生一个原生视图。
function CheckerboardBackground() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <SvgPattern
            id="checker"
            width={CHECKER_CELL * 2}
            height={CHECKER_CELL * 2}
            patternUnits="userSpaceOnUse"
          >
            <SvgRect
              width={CHECKER_CELL * 2}
              height={CHECKER_CELL * 2}
              fill="rgba(166,166,166,0.25)"
            />
            <SvgRect width={CHECKER_CELL} height={CHECKER_CELL} fill="rgba(217,217,217,0.25)" />
            <SvgRect
              x={CHECKER_CELL}
              y={CHECKER_CELL}
              width={CHECKER_CELL}
              height={CHECKER_CELL}
              fill="rgba(217,217,217,0.25)"
            />
          </SvgPattern>
        </Defs>
        <SvgRect width="100%" height="100%" fill="url(#checker)" />
      </Svg>
    </View>
  );
}

function StandardCardBody({
  item,
  displayKind,
  kindLabel,
  kindColor,
  relativeTime,
  isLatest,
  theme,
}: CardBodyProps) {
  return (
    <View style={styles.standardBody}>
      <HeaderRow kindLabel={kindLabel} relativeTime={relativeTime} theme={theme} />
      {displayKind === 'text' ? (
        <Text
          style={[styles.textContent, { color: theme.colors.onSurface }]}
          numberOfLines={4}
        >
          {item.text}
        </Text>
      ) : (
        <View style={styles.fileBody}>
          <Ionicons
            name={displayKind === 'group' ? 'folder' : 'document'}
            size={36}
            color={kindColor}
          />
          <Text
            style={[styles.fileName, { color: theme.colors.onSurfaceVariant }]}
            numberOfLines={1}
          >
            {item.dataName || item.text}
          </Text>
        </View>
      )}
      <View style={styles.spacer} />
      <BottomRow item={item} isLatest={isLatest} theme={theme} />
    </View>
  );
}

function ImageCardBody({
  item,
  kindLabel,
  relativeTime,
  isLatest,
  theme,
}: Pick<CardBodyProps, 'item' | 'kindLabel' | 'relativeTime' | 'isLatest' | 'theme'>) {
  const [loadFailed, setLoadFailed] = useState(false);
  const hasImage = item.isLocalFileReady && item.fileUri && !loadFailed;
  return (
    <View style={styles.imageBody}>
      <CheckerboardBackground />
      {hasImage ? (
        <Image
          source={{ uri: item.fileUri }}
          style={styles.thumbnailImage}
          resizeMode="contain"
          onError={() => setLoadFailed(true)}
        />
      ) : (
        <View style={[styles.imagePlaceholder, { backgroundColor: 'rgba(76,175,80,0.12)' }]}>
          <Ionicons name="image" size={36} color="rgba(76,175,80,0.5)" />
        </View>
      )}
      <GradientScrim direction="down" opacity={0.45} style={styles.topScrim} />
      <GradientScrim direction="up" opacity={0.35} style={styles.bottomScrim} />
      <View style={styles.imageOverlay}>
        <HeaderRow kindLabel={kindLabel} relativeTime={relativeTime} overlay theme={theme} />
        <View style={styles.spacer} />
        <BottomRow item={item} isLatest={isLatest} overlay theme={theme} />
      </View>
    </View>
  );
}

function URLCardBody({
  item,
  kindLabel,
  kindColor,
  relativeTime,
  isLatest,
  theme,
}: Pick<CardBodyProps, 'item' | 'kindLabel' | 'kindColor' | 'relativeTime' | 'isLatest' | 'theme'>) {
  const metadata = useURLMetadata(item.text.trim());
  const domain = getURLDomain(item.text);
  const urlText = getURLWithoutScheme(item.text);
  const hasOgImage = !!metadata?.ogImageUrl;
  const displayTitle = metadata?.title || domain;

  return (
    <View style={styles.urlBody}>
      <View style={styles.urlImageArea}>
        <View style={[styles.urlPlaceholder, { backgroundColor: 'rgba(0,188,212,0.12)' }]}>
          <Ionicons name="globe-outline" size={36} color="rgba(0,188,212,0.4)" />
        </View>
        {hasOgImage && (
          <Image
            source={{ uri: metadata!.ogImageUrl }}
            style={styles.ogImage}
            resizeMode="cover"
          />
        )}
        <GradientScrim direction="down" opacity={0.45} style={styles.topScrim} />
        <View style={styles.urlImageHeaderOverlay}>
          <HeaderRow kindLabel={kindLabel} relativeTime={relativeTime} overlay theme={theme} />
        </View>
      </View>
      <View style={[styles.urlInfoArea, { backgroundColor: iosColors?.secondarySystemGroupedBackground ?? theme.colors.surfaceContainerLow }]}>
        <Text
          style={[styles.urlTitle, { color: theme.colors.onSurface }]}
          numberOfLines={1}
        >
          {displayTitle}
        </Text>
        <Text
          style={[styles.urlText, { color: theme.colors.onSurfaceVariant }]}
          numberOfLines={1}
        >
          {urlText}
        </Text>
        <View style={styles.spacer} />
        <BottomRow item={item} isLatest={isLatest} theme={theme} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: iosDimensions.cardCornerRadius,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 5,
  },
  cardIOS: {
    ...iosCardShadow,
    borderCurve: 'continuous' as any,
  },
  standardBody: {
    flex: 1,
    padding: 12,
  },
  textContent: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  fileBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  fileName: {
    fontSize: 11,
    textAlign: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  kindLabel: {
    fontSize: 11,
  },
  kindLabelOverlay: {
    fontWeight: '500',
  },
  timeLabel: {
    fontSize: 11,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bottomSpacer: {
    flex: 1,
  },
  latestDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  spacer: {
    flex: 1,
  },
  imageBody: {
    flex: 1,
  },
  thumbnailImage: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 36,
  },
  bottomScrim: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 28,
  },
  imageOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    padding: 10,
    justifyContent: 'space-between',
  },
  urlBody: {
    flex: 1,
  },
  urlImageArea: {
    flex: 3,
    overflow: 'hidden',
  },
  ogImage: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    width: '100%',
    height: '100%',
  },
  urlPlaceholder: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  urlImageHeaderOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    padding: 10,
  },
  urlInfoArea: {
    flex: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  urlTitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  urlText: {
    fontSize: 10,
    marginTop: 2,
  },
  selectOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
