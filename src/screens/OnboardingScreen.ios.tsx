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
import { ScanLine } from 'lucide-react-native';
import { useTheme } from '@/hooks/useTheme';
import { iosAccent } from '@/theme/iosDesignTokens';
import { QrScannerModal } from '@/components/QrScannerModal';
import { BrandMark, CompanionArt, LanArt } from './onboarding/Illustrations';
import { OnboardingPile } from './onboarding/OnboardingPile';
import { ONBOARDING_SLIDES } from './OnboardingScreen.types';
import type { OnboardingScreenProps } from './OnboardingScreen.types';

const LAST = ONBOARDING_SLIDES.length - 1;

export function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const { t } = useTranslation('onboarding');
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const [scanning, setScanning] = useState(false);

  // 单色墨:iOS 品牌两极。SVG 需要具体 hex(PlatformColor 不能作为 svg 填充)。
  const ink = theme.isDark ? iosAccent.dark : iosAccent.light;
  const onInk = theme.isDark ? iosAccent.light : iosAccent.dark;
  const artBg = theme.isDark ? '#000000' : '#FFFFFF';
  const artSurface = theme.isDark ? '#1C1C1E' : '#F1F1F5';
  const artLine = theme.isDark ? 'rgba(84,84,88,0.55)' : 'rgba(60,60,67,0.16)';
  const artFg2 = theme.isDark ? '#9A9AA1' : '#6C6C72';

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
            <BrandMark color={ink} size={62} />
            <Text style={[s.wordmark, { color: theme.colors.textPrimary }]}>
              {t('welcome.wordmark')}
            </Text>
          </View>
        );
      case 'companion':
        return (
          <CompanionArt accent={ink} line={artLine} surface={artSurface} bg={artBg} fg2={artFg2} />
        );
      case 'lan':
        return <LanArt accent={ink} line={artLine} bg={artBg} fg2={artFg2} />;
      case 'action':
        return <OnboardingPile />;
      default:
        return null;
    }
  };

  return (
    <SafeAreaView
      style={[s.root, { backgroundColor: theme.colors.background }]}
      edges={['top', 'bottom']}
    >
      {/* skip */}
      <View style={s.topBar}>
        {page < LAST && (
          <Pressable onPress={() => goTo(LAST)} hitSlop={10} accessibilityRole="button">
            <Text style={[s.skip, { color: theme.colors.textSecondary }]}>{t('skip')}</Text>
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
              <Text style={[s.kicker, { color: theme.colors.textTertiary }]}>
                {String(ONBOARDING_SLIDES.indexOf(key) + 1).padStart(2, '0')}
              </Text>
              <View style={s.artWrap}>{renderArt(key)}</View>
              <Text style={[s.title, { color: theme.colors.textPrimary }]}>
                {t(`${key}.title`)}
              </Text>
              <Text style={[s.body, { color: theme.colors.textSecondary }]}>
                {t(`${key}.body`)}
              </Text>
              {(key === 'companion' || key === 'lan') && (
                <View style={[s.spec, { borderColor: theme.colors.separator }]}>
                  <View style={[s.specDot, { backgroundColor: '#34C759' }]} />
                  <Text style={[s.specText, { color: theme.colors.textPrimary }]}>
                    {t(`${key}.spec`)}
                  </Text>
                </View>
              )}
              {key === 'action' && (
                <Text style={[s.types, { color: theme.colors.textSecondary }]}>
                  {t('action.types')}
                </Text>
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
              { backgroundColor: theme.colors.textTertiary },
              i === page && [s.dotOn, { backgroundColor: ink }],
            ]}
          />
        ))}
      </View>

      {/* actions */}
      <View style={s.dock}>
        {page < LAST ? (
          <Pressable style={[s.cta, { backgroundColor: ink }]} onPress={() => goTo(page + 1)}>
            <Text style={[s.ctaText, { color: onInk }]}>{t('continue')}</Text>
          </Pressable>
        ) : (
          <>
            <Pressable style={[s.cta, { backgroundColor: ink }]} onPress={() => setScanning(true)}>
              <ScanLine size={18} color={onInk} />
              <Text style={[s.ctaText, { color: onInk }]}>{t('action.pair')}</Text>
            </Pressable>
            <Pressable style={s.cta2} onPress={() => onComplete()} hitSlop={6}>
              <Text style={[s.cta2Text, { color: theme.colors.textSecondary }]}>
                {t('action.later')}
              </Text>
            </Pressable>
          </>
        )}
      </View>

      <QrScannerModal
        visible={scanning}
        onClose={() => setScanning(false)}
        onScanned={() => {
          setScanning(false);
          onComplete();
        }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  topBar: { height: 40, paddingHorizontal: 20, alignItems: 'flex-end', justifyContent: 'center' },
  skip: { fontSize: 15, fontWeight: '500' },
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
  title: {
    fontSize: 27,
    lineHeight: 33,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.3,
    marginTop: 12,
  },
  body: { fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 12, maxWidth: 300 },
  spec: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
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
    borderRadius: 15,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  ctaText: { fontSize: 16, fontWeight: '600' },
  cta2: { height: 46, alignItems: 'center', justifyContent: 'center' },
  cta2Text: { fontSize: 14.5, fontWeight: '600' },
});
