import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Image, Pressable, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ArrowDown, ArrowUp } from 'lucide-react-native';
import { useTheme } from '@/hooks/useTheme';
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
  return (
    <View style={styles.bottomRow}>
      {item.from ? (
        <ArrowDown size={10} color={dirColor} />
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
  const hasImage = item.isLocalFileReady && item.fileUri;
  return (
    <View style={styles.imageBody}>
      {/* Checkerboard background */}
      <View style={styles.checkerboard}>
        {hasImage ? (
          <Image
            source={{ uri: item.fileUri }}
            style={styles.thumbnailImage}
            resizeMode="contain"
          />
        ) : (
          <View style={[styles.imagePlaceholder, { backgroundColor: 'rgba(76,175,80,0.12)' }]}>
            <Ionicons name="image" size={36} color="rgba(76,175,80,0.5)" />
          </View>
        )}
      </View>
      {/* Gradient scrims */}
      <View style={styles.topGradient} />
      <View style={styles.bottomGradient} />
      {/* Overlaid header + footer */}
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
  const domain = getURLDomain(item.text);
  const urlText = getURLWithoutScheme(item.text);
  return (
    <View style={styles.urlBody}>
      {/* Top 60%: placeholder or OG image */}
      <View style={[styles.urlImageArea, { backgroundColor: 'rgba(0,188,212,0.12)' }]}>
        <Ionicons name="globe-outline" size={36} color="rgba(0,188,212,0.4)" />
        {/* Top gradient + header */}
        <View style={styles.topGradient} />
        <View style={styles.urlImageOverlay}>
          <HeaderRow kindLabel={kindLabel} relativeTime={relativeTime} overlay theme={theme} />
        </View>
      </View>
      {/* Bottom 40%: domain + URL */}
      <View style={[styles.urlInfoArea, { backgroundColor: iosColors?.secondarySystemGroupedBackground ?? theme.colors.surfaceContainerLow }]}>
        <Text
          style={[styles.urlDomain, { color: theme.colors.onSurface }]}
          numberOfLines={1}
        >
          {domain}
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
  // Standard (text/file/group)
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
  // Header / Bottom
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
  // Image card
  imageBody: {
    flex: 1,
  },
  checkerboard: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(200,200,200,0.15)',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 36,
    backgroundColor: 'transparent',
    // Using a simple semi-transparent overlay since RN doesn't have LinearGradient built-in
    // We'll use a View with opacity
  },
  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 28,
    backgroundColor: 'transparent',
  },
  imageOverlay: {
    ...StyleSheet.absoluteFill,
    padding: 10,
    justifyContent: 'space-between',
    // Semi-transparent scrims for text legibility
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  // URL card
  urlBody: {
    flex: 1,
  },
  urlImageArea: {
    flex: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  urlImageOverlay: {
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
  urlDomain: {
    fontSize: 12,
    fontWeight: '600',
  },
  urlText: {
    fontSize: 10,
    marginTop: 2,
  },
  // Select overlay
  selectOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
