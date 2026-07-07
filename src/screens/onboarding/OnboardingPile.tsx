/**
 * 引导第 4 屏「同步类型」拟物化插画 —— 桌面实物堆(方案 D)。
 *
 * 平台中性:四个物件用各自的固有材质色(便签黄、宝丽来白、牛皮文档、链接吊牌),
 * 在浅/深、iOS/Android 下都保持本色。类型签名色取自 iosKindTints(纯 hex 常量,跨端安全)。
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect, Circle, Path } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { iosKindTints } from '@/theme/iosDesignTokens';

const K = iosKindTints;

export function OnboardingPile() {
  const { t } = useTranslation('onboarding');
  return (
    <View
      style={s.pile}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* 链接吊牌(最底) */}
      <View style={[s.obj, s.tag]}>
        <View style={s.punch} />
        <Svg width={13} height={13} viewBox="0 0 24 24">
          <Path d="M9 15l6-6" stroke={K.url} strokeWidth={2.3} strokeLinecap="round" fill="none" />
          <Path
            d="M11.5 5.5l1-1a4.2 4.2 0 0 1 6 6l-1 1"
            stroke={K.url}
            strokeWidth={2.3}
            strokeLinecap="round"
            fill="none"
          />
          <Path
            d="M12.5 18.5l-1 1a4.2 4.2 0 0 1-6-6l1-1"
            stroke={K.url}
            strokeWidth={2.3}
            strokeLinecap="round"
            fill="none"
          />
        </Svg>
        <Text style={s.tagText} numberOfLines={1}>
          uniclipboard.app
        </Text>
      </View>

      {/* 便签(文本) */}
      <View style={[s.obj, s.sticky]}>
        <Text style={s.stickyText}>{t('action.pile.note')}</Text>
        <View style={s.stickyFold} />
      </View>

      {/* 宝丽来(图片) */}
      <View style={[s.obj, s.polaroid]}>
        <View style={s.photo}>
          <Svg width={72} height={68} viewBox="0 0 82 66">
            <Defs>
              <LinearGradient id="onbPileSky" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#7EC8E3" />
                <Stop offset="1" stopColor="#C7EBD1" />
              </LinearGradient>
            </Defs>
            <Rect width={82} height={66} fill="url(#onbPileSky)" />
            <Circle cx={60} cy={17} r={7} fill="#FFE08A" />
            <Path d="M0 66 L24 40 L40 52 L58 32 L82 66 Z" fill="#34C759" />
            <Path d="M0 66 L30 50 L52 60 L82 46 L82 66 Z" fill="#1F9E46" />
          </Svg>
        </View>
        <Text style={s.photoCap}>IMG_2043</Text>
      </View>

      {/* 文档(文件,最前) */}
      <View style={[s.obj, s.doc]}>
        <View style={s.dogEar} />
        <View style={s.docLines}>
          <View style={[s.docLine, { width: '80%' }]} />
          <View style={[s.docLine, { width: '94%' }]} />
          <View style={[s.docLine, { width: '68%' }]} />
          <View style={[s.docLine, { width: '88%' }]} />
        </View>
        <View style={s.pdfBadge}>
          <Text style={s.pdfText}>PDF</Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  pile: { width: 236, height: 176, alignSelf: 'center' },
  obj: {
    position: 'absolute',
    shadowColor: '#15171C',
    shadowOffset: { width: 0, height: 9 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 6,
  },

  // link tag
  tag: {
    left: 44,
    top: 0,
    width: 66,
    height: 38,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(21,23,28,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    transform: [{ rotate: '4deg' }],
  },
  punch: {
    position: 'absolute',
    left: 8,
    top: -3,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#b9c4ca',
    backgroundColor: 'transparent',
  },
  tagText: { fontSize: 8.5, fontWeight: '700', color: '#40525a', flexShrink: 1 },

  // sticky note
  sticky: {
    left: 6,
    top: 40,
    width: 92,
    height: 92,
    borderRadius: 2,
    backgroundColor: '#FFD64D',
    padding: 11,
    transform: [{ rotate: '-6deg' }],
  },
  stickyText: { fontSize: 10.5, lineHeight: 16, fontWeight: '600', color: '#5c4a12' },
  stickyFold: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    borderStyle: 'solid',
    borderRightWidth: 22,
    borderTopWidth: 22,
    borderRightColor: 'transparent',
    borderTopColor: 'rgba(0,0,0,0.10)',
  },

  // polaroid
  polaroid: {
    left: 100,
    top: 8,
    width: 84,
    height: 100,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 6,
    paddingTop: 6,
    transform: [{ rotate: '5deg' }],
  },
  photo: { height: 68, borderRadius: 1, overflow: 'hidden' },
  photoCap: {
    fontSize: 8,
    color: '#8a8a90',
    textAlign: 'center',
    paddingVertical: 5,
    fontVariant: ['tabular-nums'],
  },

  // document
  doc: {
    left: 154,
    top: 52,
    width: 78,
    height: 96,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
    transform: [{ rotate: '-3deg' }],
    overflow: 'hidden',
  },
  dogEar: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 0,
    height: 0,
    borderStyle: 'solid',
    borderTopWidth: 20,
    borderLeftWidth: 20,
    borderTopColor: '#e4e0d7',
    borderLeftColor: 'transparent',
  },
  docLines: { paddingHorizontal: 11, paddingTop: 16, gap: 5 },
  docLine: { height: 4, borderRadius: 2, backgroundColor: '#c9c5bc' },
  pdfBadge: {
    position: 'absolute',
    left: 9,
    bottom: 9,
    backgroundColor: K.file,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  pdfText: { fontSize: 8, fontWeight: '700', color: '#FFFFFF' },
});
