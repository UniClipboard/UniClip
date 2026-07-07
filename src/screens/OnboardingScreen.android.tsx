import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '@/hooks/useTheme';
import { QrScannerModal } from '@/components/QrScannerModal';
import { BrandMark, CompanionArt, LanArt } from './onboarding/Illustrations';
import { OnboardingPile } from './onboarding/OnboardingPile';
import { ONBOARDING_SLIDES } from './OnboardingScreen.types';
import type { OnboardingScreenProps } from './OnboardingScreen.types';

const LAST = ONBOARDING_SLIDES.length - 1;

export function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const { t } = useTranslation('onboarding');
  const { theme } = useTheme();
  const c = theme.colors;
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const [scanning, setScanning] = useState(false);

  // Material 3 强调色为 hex,SVG 可直接着色。品牌标恒用墨/纸两极(跨平台常量)。
  const accent = c.accent as string;
  const brand = theme.isDark ? '#F4F2EE' : '#15171C';
  const artBg = c.background as string;
  const artSurface = c.surfaceHigh as string;
  const artLine = c.separator as string;
  const artFg2 = c.textSecondary as string;

  const goTo = useCallback(
    (p: number) => {
      const next = Math.max(0, Math.min(LAST, p));
      scrollRef.current?.scrollTo({ x: next * width, animated: true });
    },
    [width]
  );

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      setPage(Math.round(e.nativeEvent.contentOffset.x / width));
    },
    [width]
  );

  const renderArt = (key: string) => {
    switch (key) {
      case 'welcome':
        return (
          <View style={s.artCol}>
            <BrandMark color={brand} size={62} />
            <Text style={[s.wordmark, { color: c.textPrimary }]}>{t('welcome.wordmark')}</Text>
          </View>
        );
      case 'companion':
        return (
          <CompanionArt
            accent={accent}
            line={artLine}
            surface={artSurface}
            bg={artBg}
            fg2={artFg2}
          />
        );
      case 'lan':
        return <LanArt accent={accent} line={artLine} bg={artBg} fg2={artFg2} />;
      case 'action':
        return <OnboardingPile />;
      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={[s.root, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
      {/* skip */}
      <View style={s.topBar}>
        {page < LAST && (
          <Pressable onPress={() => goTo(LAST)} hitSlop={10} accessibilityRole="button">
            <Text style={[s.skip, { color: c.textSecondary }]}>{t('skip')}</Text>
          </Pressable>
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        style={s.deck}
      >
        {ONBOARDING_SLIDES.map((key) => (
          <View key={key} style={[s.page, { width }]}>
            <View style={s.slideInner}>
              <Text style={[s.kicker, { color: c.textTertiary }]}>
                {String(ONBOARDING_SLIDES.indexOf(key) + 1).padStart(2, '0')}
              </Text>
              <View style={s.artWrap}>{renderArt(key)}</View>
              <Text style={[s.title, { color: c.textPrimary }]}>{t(`${key}.title`)}</Text>
              <Text style={[s.body, { color: c.textSecondary }]}>{t(`${key}.body`)}</Text>
              {(key === 'companion' || key === 'lan') && (
                <View style={[s.spec, { backgroundColor: c.accentContainer }]}>
                  <View style={[s.specDot, { backgroundColor: '#34C759' }]} />
                  <Text style={[s.specText, { color: c.onAccentContainer }]}>
                    {t(`${key}.spec`)}
                  </Text>
                </View>
              )}
              {key === 'action' && (
                <Text style={[s.types, { color: c.textSecondary }]}>{t('action.types')}</Text>
              )}
            </View>
          </View>
        ))}
      </ScrollView>

      {/* dots */}
      <View style={s.dots}>
        {ONBOARDING_SLIDES.map((key, i) => (
          <View
            key={key}
            style={[
              s.dot,
              { backgroundColor: c.textTertiary },
              i === page && [s.dotOn, { backgroundColor: accent }],
            ]}
          />
        ))}
      </View>

      {/* actions */}
      <View style={s.dock}>
        {page < LAST ? (
          <Pressable
            style={[s.cta, { backgroundColor: accent }]}
            android_ripple={{ color: 'rgba(255,255,255,0.18)' }}
            onPress={() => goTo(page + 1)}
          >
            <Text style={[s.ctaText, { color: c.onAccent }]}>{t('continue')}</Text>
          </Pressable>
        ) : (
          <>
            <Pressable
              style={[s.cta, { backgroundColor: accent }]}
              android_ripple={{ color: 'rgba(255,255,255,0.18)' }}
              onPress={() => setScanning(true)}
            >
              <Ionicons name="scan-outline" size={19} color={c.onAccent as string} />
              <Text style={[s.ctaText, { color: c.onAccent }]}>{t('action.pair')}</Text>
            </Pressable>
            <Pressable style={s.cta2} onPress={() => onComplete({ paired: false })} hitSlop={6}>
              <Text style={[s.cta2Text, { color: c.textSecondary }]}>{t('action.later')}</Text>
            </Pressable>
          </>
        )}
      </View>

      <QrScannerModal
        visible={scanning}
        onClose={() => setScanning(false)}
        onScanned={() => {
          setScanning(false);
          onComplete({ paired: true });
        }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  topBar: { height: 44, paddingHorizontal: 20, alignItems: 'flex-end', justifyContent: 'center' },
  skip: { fontSize: 14, fontWeight: '500' },
  deck: { flex: 1 },
  page: { flex: 1 },
  slideInner: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  kicker: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
    marginBottom: 4,
  },
  artWrap: { minHeight: 132, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  artCol: { alignItems: 'center' },
  wordmark: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 3,
    marginTop: 12,
    textTransform: 'uppercase',
  },
  title: { fontSize: 26, lineHeight: 33, fontWeight: '600', textAlign: 'center', marginTop: 12 },
  body: { fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 12, maxWidth: 300 },
  spec: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
    marginTop: 18,
  },
  specDot: { width: 5, height: 5, borderRadius: 3 },
  specText: { fontSize: 11, fontWeight: '600', letterSpacing: 0.4 },
  types: { fontSize: 12, letterSpacing: 1, marginTop: 16 },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    height: 24,
  },
  dot: { width: 8, height: 8, borderRadius: 4, opacity: 0.5 },
  dotOn: { width: 22, opacity: 1 },
  dock: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 8, gap: 4 },
  cta: {
    height: 52,
    borderRadius: 100,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    elevation: 2,
  },
  ctaText: { fontSize: 16, fontWeight: '600' },
  cta2: { height: 46, alignItems: 'center', justifyContent: 'center' },
  cta2Text: { fontSize: 14.5, fontWeight: '600' },
});
