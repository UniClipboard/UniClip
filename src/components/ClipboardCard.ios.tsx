import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Image, Pressable } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, {
  Defs,
  LinearGradient as SvgLinearGradient,
  Stop,
  Rect as SvgRect,
  Pattern as SvgPattern,
} from 'react-native-svg';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Circle,
  Clock,
  File,
  FolderOpen,
  Image as ImageIcon,
} from 'lucide-react-native';
import { useURLMetadata } from '@/hooks/useURLMetadata';
import { useClipboardCardViewModel } from '@/hooks/useClipboardCardViewModel';
import { ClipboardItem } from '@/types/clipboard';
import {
  iosColors,
  iosAccentColor,
  iosCardShadow,
  iosDimensions,
  iosKindTints,
  hexToRgba,
} from '@/theme/iosDesignTokens';
import { getURLDomain, getURLWithoutScheme, type DisplayKind } from '@/utils/displayKind';
import { getDomainGradient, getDomainInitial, type DomainGradient } from '@/utils/domainColor';
import type { HistoryDirectionIndicator } from '@/utils/historyDirection';
import type { ClipboardCardProps } from './ClipboardCard.types';

export const ClipboardCard: React.FC<ClipboardCardProps> = React.memo(
  ({ item, isLatest, isSelected, isSelectMode, onPress, onLongPress, cardSize }) => {
    const { displayKind, kindLabel, relativeTime, directionIndicator } =
      useClipboardCardViewModel(item);
    const kindColor = iosKindTints[displayKind];

    // 按压时轻微收缩，预告"长按有戏"；长按触发后由浮层接管，pressOut 回弹
    const cardRef = useRef<View>(null);
    const pressScale = useSharedValue(1);
    const pressStyle = useAnimatedStyle(() => ({
      transform: [{ scale: pressScale.value }],
    }));

    const handleLongPress = () => {
      if (!onLongPress) return;
      const node = cardRef.current;
      if (!node) {
        onLongPress(item, null);
        return;
      }
      node.measureInWindow((x, y, width, height) => {
        onLongPress(item, width > 0 && height > 0 ? { x, y, width, height } : null);
      });
    };

    return (
      <Animated.View style={pressStyle}>
        <Pressable
          ref={cardRef}
          onPress={() => onPress(item)}
          onLongPress={handleLongPress}
          delayLongPress={350}
          onPressIn={() => {
            pressScale.value = withTiming(0.97, { duration: 180 });
          }}
          onPressOut={() => {
            pressScale.value = withTiming(1, { duration: 150 });
          }}
          style={[
            styles.card,
            {
              width: cardSize,
              height: cardSize,
              backgroundColor: iosColors!.secondarySystemGroupedBackground,
              borderColor: isSelected ? iosAccentColor : 'transparent',
              borderWidth: isSelected ? 2 : 0,
            },
          ]}
        >
          <CardBody
            item={item}
            displayKind={displayKind}
            kindLabel={kindLabel}
            kindColor={kindColor}
            relativeTime={relativeTime}
            directionIndicator={directionIndicator}
            isLatest={isLatest}
          />
          {isSelectMode && (
            <View style={styles.selectOverlay}>
              {isSelected ? (
                <View style={[styles.checkBadge, { backgroundColor: iosAccentColor }]}>
                  <Check size={16} color="#fff" strokeWidth={3} />
                </View>
              ) : (
                <Circle size={28} color={iosColors!.tertiaryLabel} />
              )}
            </View>
          )}
        </Pressable>
      </Animated.View>
    );
  }
);

interface CardBodyProps {
  item: ClipboardItem;
  displayKind: DisplayKind;
  kindLabel: string;
  kindColor: string;
  relativeTime: string;
  directionIndicator: HistoryDirectionIndicator;
  isLatest: boolean;
}

function CardBody(props: CardBodyProps) {
  switch (props.displayKind) {
    case 'image':
      return <ImageCardBody {...props} />;
    case 'url':
      return <URLCardBody {...props} />;
    default:
      return <StandardCardBody {...props} />;
  }
}

function HeaderRow({
  kindLabel,
  relativeTime,
  overlay,
}: {
  kindLabel: string;
  relativeTime: string;
  overlay?: boolean;
}) {
  return (
    <View style={styles.headerRow}>
      <Text
        style={[
          styles.kindLabel,
          { color: overlay ? '#fff' : iosColors!.secondaryLabel },
          overlay && styles.kindLabelOverlay,
        ]}
      >
        {kindLabel}
      </Text>
      <Text
        style={[
          styles.timeLabel,
          { color: overlay ? 'rgba(255,255,255,0.8)' : iosColors!.tertiaryLabel },
        ]}
      >
        {relativeTime}
      </Text>
    </View>
  );
}

function BottomRow({
  directionIndicator,
  isLatest,
  overlay,
}: {
  directionIndicator: HistoryDirectionIndicator;
  isLatest: boolean;
  overlay?: boolean;
}) {
  const dirColor = overlay ? 'rgba(255,255,255,0.7)' : iosColors!.secondaryLabel;
  return (
    <View style={styles.bottomRow}>
      {directionIndicator === 'download' ? (
        <ArrowDown size={10} color={dirColor} />
      ) : directionIndicator === 'pendingUpload' || directionIndicator === 'pendingSync' ? (
        <Clock size={10} color={dirColor} />
      ) : (
        <ArrowUp size={10} color={dirColor} />
      )}
      <View style={styles.bottomSpacer} />
      {isLatest && (
        <View style={[styles.latestDot, { backgroundColor: overlay ? '#fff' : iosAccentColor }]} />
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
            <Stop offset="0" stopColor="black" stopOpacity={direction === 'down' ? opacity : 0} />
            <Stop offset="1" stopColor="black" stopOpacity={direction === 'down' ? 0 : opacity} />
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
  directionIndicator,
  isLatest,
}: CardBodyProps) {
  return (
    <View style={styles.standardBody}>
      <HeaderRow kindLabel={kindLabel} relativeTime={relativeTime} />
      {displayKind === 'text' ? (
        <Text style={[styles.textContent, { color: iosColors!.label }]} numberOfLines={4}>
          {item.text}
        </Text>
      ) : (
        <View style={styles.fileBody}>
          {displayKind === 'group' ? (
            <FolderOpen size={36} color={kindColor} />
          ) : (
            <File size={36} color={kindColor} />
          )}
          <Text style={[styles.fileName, { color: iosColors!.secondaryLabel }]} numberOfLines={1}>
            {item.dataName || item.text}
          </Text>
        </View>
      )}
      <View style={styles.spacer} />
      <BottomRow directionIndicator={directionIndicator} isLatest={isLatest} />
    </View>
  );
}

function ImageCardBody({
  item,
  kindColor,
  kindLabel,
  relativeTime,
  directionIndicator,
  isLatest,
}: CardBodyProps) {
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
        <View style={[styles.imagePlaceholder, { backgroundColor: hexToRgba(kindColor, 0.12) }]}>
          <ImageIcon size={36} color={hexToRgba(kindColor, 0.5)} />
        </View>
      )}
      <GradientScrim direction="down" opacity={0.45} style={styles.topScrim} />
      <GradientScrim direction="up" opacity={0.35} style={styles.bottomScrim} />
      <View style={styles.imageOverlay}>
        <HeaderRow kindLabel={kindLabel} relativeTime={relativeTime} overlay />
        <View style={styles.spacer} />
        <BottomRow directionIndicator={directionIndicator} isLatest={isLatest} overlay />
      </View>
    </View>
  );
}

// 方案 A「沉浸全出血」：OG 图铺满整卡，底部 scrim 上叠 favicon + 域名 + 两行标题；
// 无 OG 图时用域名派生色渐变 + 居中 favicon 兜底
function URLCardBody({
  item,
  kindLabel,
  relativeTime,
  directionIndicator,
  isLatest,
}: CardBodyProps) {
  const metadata = useURLMetadata(item.text.trim());
  const domain = getURLDomain(item.text);
  const urlText = getURLWithoutScheme(item.text);
  const hasOgImage = !!metadata?.ogImageUrl;
  const displayTitle = metadata?.title || urlText;
  const gradient = getDomainGradient(domain);
  const dirColor = 'rgba(255,255,255,0.7)';

  return (
    <View style={styles.urlBody}>
      <DomainGradientBackground gradient={gradient} />
      {metadata && !hasOgImage && (
        <View style={styles.urlFallbackCenter}>
          <Favicon url={metadata.faviconUrl} domain={domain} size={44} />
        </View>
      )}
      {hasOgImage && (
        <Image source={{ uri: metadata!.ogImageUrl }} style={styles.ogImage} resizeMode="cover" />
      )}
      <GradientScrim direction="down" opacity={0.5} style={styles.topScrim} />
      <URLBottomScrim />
      <View style={styles.urlOverlay}>
        <HeaderRow kindLabel={kindLabel} relativeTime={relativeTime} overlay />
        <View style={styles.spacer} />
        <View style={styles.urlDomainRow}>
          <Favicon url={metadata?.faviconUrl} domain={domain} size={16} />
          <Text style={styles.urlDomain} numberOfLines={1}>
            {domain}
          </Text>
          <View style={styles.bottomSpacer} />
          {directionIndicator === 'download' ? (
            <ArrowDown size={10} color={dirColor} />
          ) : directionIndicator === 'pendingUpload' || directionIndicator === 'pendingSync' ? (
            <Clock size={10} color={dirColor} />
          ) : (
            <ArrowUp size={10} color={dirColor} />
          )}
          {isLatest && <View style={[styles.latestDot, styles.urlLatestDot]} />}
        </View>
        <Text style={styles.urlTitle} numberOfLines={2}>
          {displayTitle}
        </Text>
      </View>
    </View>
  );
}

// 无 OG 图时的整卡对角渐变兜底，颜色由域名哈希派生，同域名恒定
function DomainGradientBackground({ gradient }: { gradient: DomainGradient }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <SvgLinearGradient id="domainBg" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={gradient.start} stopOpacity={1} />
            <Stop offset="1" stopColor={gradient.end} stopOpacity={1} />
          </SvgLinearGradient>
        </Defs>
        <SvgRect width="100%" height="100%" fill="url(#domainBg)" />
      </Svg>
    </View>
  );
}

// 底部文字区 scrim：比图片卡的更高更深，保证 favicon/域名/标题在任意 OG 图上可读
function URLBottomScrim() {
  return (
    <View style={styles.urlBottomScrim} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <SvgLinearGradient id="urlScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="black" stopOpacity={0} />
            <Stop offset="0.55" stopColor="black" stopOpacity={0.5} />
            <Stop offset="1" stopColor="black" stopOpacity={0.78} />
          </SvgLinearGradient>
        </Defs>
        <SvgRect width="100%" height="100%" fill="url(#urlScrim)" />
      </Svg>
    </View>
  );
}

// favicon 图；缺失或解码失败（如 Android 不支持的 .ico）时回退为白底域名字标
function Favicon({ url, domain, size }: { url?: string; domain: string; size: number }) {
  const [failed, setFailed] = useState(false);
  const shape = {
    width: size,
    height: size,
    borderRadius: Math.round(size * 0.28),
  };
  if (url && !failed) {
    return (
      <Image
        source={{ uri: url }}
        style={[styles.faviconTile, shape]}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <View style={[styles.faviconTile, styles.faviconFallback, shape]}>
      <Text
        style={{
          color: getDomainGradient(domain).start,
          fontWeight: '800',
          fontSize: Math.round(size * 0.55),
        }}
      >
        {getDomainInitial(domain)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: iosDimensions.cardCornerRadius,
    borderCurve: 'continuous' as any,
    overflow: 'hidden',
    ...iosCardShadow,
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
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    padding: 10,
    justifyContent: 'space-between',
  },
  urlBody: {
    flex: 1,
  },
  ogImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  urlFallbackCenter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  urlBottomScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '62%',
  },
  urlOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    padding: 10,
    paddingBottom: 11,
  },
  urlDomainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  urlDomain: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.8)',
    flexShrink: 1,
  },
  urlTitle: {
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '600',
    color: '#fff',
    marginTop: 5,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  urlLatestDot: {
    backgroundColor: '#fff',
  },
  faviconTile: {
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  faviconFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
