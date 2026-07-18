import { Ionicons } from '@expo/vector-icons';
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { AppBottomSheet } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import type { ClipboardAccessMethod } from '@/types/settings';
import {
  clipboardAccessSheetReducer,
  getMethodPageHeight,
  getSheetContentMaxHeight,
  INITIAL_CLIPBOARD_ACCESS_SHEET_STATE,
} from './ClipboardAccessMethodSheet.state';
import type {
  AdbSetupStage,
  ClipboardAccessMethodSheetController,
  OpenAdbSetupSheetOptions,
  OpenClipboardAccessMethodSheetOptions,
} from './ClipboardAccessMethodSheet.types';

const METHODS: ClipboardAccessMethod[] = ['overlay-polling', 'overlay-event', 'shizuku'];
const PAGE_GAP = 12;
const PAGE_HORIZONTAL_INSET = 16;

type IoniconName = ComponentProps<typeof Ionicons>['name'];

const ClipboardAccessMethodSheetContext =
  createContext<ClipboardAccessMethodSheetController | null>(null);

export function useClipboardAccessMethodSheet(): ClipboardAccessMethodSheetController {
  const controller = useContext(ClipboardAccessMethodSheetContext);
  if (!controller) {
    throw new Error('useClipboardAccessMethodSheet must be used inside its provider');
  }
  return controller;
}

export function ClipboardAccessMethodSheetProvider({ children }: { children: ReactNode }) {
  const [{ visible, content, isSelecting }, dispatch] = useReducer(
    clipboardAccessSheetReducer,
    INITIAL_CLIPBOARD_ACCESS_SHEET_STATE
  );
  const selectingRef = useRef(false);

  const openMethodSheet = useCallback((options: OpenClipboardAccessMethodSheetOptions) => {
    dispatch({ type: 'open-methods', options });
  }, []);

  const openAdbSetupSheet = useCallback((options: OpenAdbSetupSheetOptions) => {
    dispatch({ type: 'open-adb', options });
  }, []);

  const closeSheet = useCallback(() => dispatch({ type: 'close' }), []);
  const controller = useMemo(
    () => ({ openMethodSheet, openAdbSetupSheet, closeSheet }),
    [closeSheet, openAdbSetupSheet, openMethodSheet]
  );

  const handleSelect = useCallback(
    async (method: ClipboardAccessMethod) => {
      if (content?.type !== 'methods' || selectingRef.current) return;
      selectingRef.current = true;
      dispatch({ type: 'selection-started' });
      const onSelect = content.onSelect;
      try {
        await onSelect(method);
      } finally {
        selectingRef.current = false;
        dispatch({ type: 'selection-finished' });
      }
    },
    [content]
  );

  return (
    <ClipboardAccessMethodSheetContext.Provider value={controller}>
      {children}
      <AppBottomSheet visible={visible} onDismiss={closeSheet}>
        {content?.type === 'methods' ? (
          <MethodComparisonSheet
            key={content.selectedMethod}
            selectedMethod={content.selectedMethod}
            isSelecting={isSelecting}
            onSelect={handleSelect}
            onClose={closeSheet}
          />
        ) : null}
        {content?.type === 'adb' ? (
          <AdbSetupSheet
            stage={content.stage}
            command={content.command}
            onCopy={content.onCopy}
            onCheck={content.onCheck}
            onClose={closeSheet}
          />
        ) : null}
      </AppBottomSheet>
    </ClipboardAccessMethodSheetContext.Provider>
  );
}

interface MethodComparisonSheetProps {
  selectedMethod: ClipboardAccessMethod;
  isSelecting: boolean;
  onSelect: (method: ClipboardAccessMethod) => void;
  onClose: () => void;
}

const MethodComparisonSheet = memo(function MethodComparisonSheet({
  selectedMethod,
  isSelecting,
  onSelect,
  onClose,
}: MethodComparisonSheetProps) {
  const { t } = useTranslation('settingsBackground');
  const { theme } = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const listRef = useRef<FlatList<ClipboardAccessMethod>>(null);
  const pageWidth = windowWidth - PAGE_HORIZONTAL_INSET * 2 - 20;
  const pageHeight = getMethodPageHeight(windowHeight);
  const snapInterval = pageWidth + PAGE_GAP;
  const initialIndex = Math.max(0, METHODS.indexOf(selectedMethod));
  const [activeIndex, setActiveIndex] = useState(initialIndex);

  const getItemLayout = useCallback(
    (_data: ArrayLike<ClipboardAccessMethod> | null | undefined, index: number) => ({
      length: snapInterval,
      offset: snapInterval * index,
      index,
    }),
    [snapInterval]
  );

  const renderItem = useCallback(
    ({ item }: { item: ClipboardAccessMethod }) => (
      <MethodPage
        method={item}
        selected={item === selectedMethod}
        disabled={isSelecting}
        width={pageWidth}
        height={pageHeight}
        onSelect={onSelect}
      />
    ),
    [isSelecting, onSelect, pageHeight, pageWidth, selectedMethod]
  );

  const handleMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const nextIndex = Math.max(
        0,
        Math.min(METHODS.length - 1, Math.round(event.nativeEvent.contentOffset.x / snapInterval))
      );
      setActiveIndex(nextIndex);
    },
    [snapInterval]
  );

  const goToPage = useCallback((index: number) => {
    setActiveIndex(index);
    listRef.current?.scrollToIndex({ index, animated: true });
  }, []);

  return (
    <View style={styles.sheetBody}>
      <SheetHeader
        title={t('advanced.clipboardAccess.sheet.title')}
        subtitle={t('advanced.clipboardAccess.sheet.subtitle')}
        onClose={onClose}
      />

      <FlatList
        ref={listRef}
        data={METHODS}
        horizontal
        initialScrollIndex={initialIndex}
        keyExtractor={(item) => item}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        ItemSeparatorComponent={PageSeparator}
        contentContainerStyle={styles.carouselContent}
        showsHorizontalScrollIndicator={false}
        snapToInterval={snapInterval}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        onMomentumScrollEnd={handleMomentumEnd}
      />

      <View style={styles.pageIndicatorRow}>
        {METHODS.map((method, index) => (
          <Pressable
            key={method}
            onPress={() => goToPage(index)}
            accessibilityRole="button"
            accessibilityLabel={t('advanced.clipboardAccess.sheet.pageLabel', {
              current: index + 1,
              total: METHODS.length,
            })}
            style={styles.pageIndicatorHitbox}
          >
            <View
              style={[
                styles.pageIndicator,
                {
                  backgroundColor:
                    activeIndex === index ? theme.colors.accent : theme.colors.separator,
                },
              ]}
            />
          </Pressable>
        ))}
      </View>
    </View>
  );
});

function PageSeparator() {
  return <View style={styles.pageSeparator} />;
}

interface MethodPageProps {
  method: ClipboardAccessMethod;
  selected: boolean;
  disabled: boolean;
  width: number;
  height: number;
  onSelect: (method: ClipboardAccessMethod) => void;
}

const MethodPage = memo(function MethodPage({
  method,
  selected,
  disabled,
  width,
  height,
  onSelect,
}: MethodPageProps) {
  const { t } = useTranslation('settingsBackground');
  const { theme } = useTheme();
  const icon = getMethodIcon(method);
  const prefix = `advanced.clipboardAccess.sheet.methods.${method}`;

  const handleSelect = useCallback(() => onSelect(method), [method, onSelect]);

  return (
    <View
      style={[
        styles.methodPage,
        {
          width,
          height,
          backgroundColor: theme.colors.surfaceHigh,
          borderColor: selected ? theme.colors.accent : theme.colors.separator,
        },
      ]}
    >
      <ScrollView
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.methodPageContent}
      >
        <View style={styles.methodHeading}>
          <View style={[styles.methodIcon, { backgroundColor: theme.colors.accentContainer }]}>
            <Ionicons name={icon} size={24} color={theme.colors.onAccentContainer} />
          </View>
          <View style={styles.methodTitleGroup}>
            <View style={styles.methodTitleRow}>
              <Text style={[styles.methodTitle, { color: theme.colors.textPrimary }]}>
                {t(`${prefix}.title`)}
              </Text>
              {method === 'overlay-polling' ? (
                <View
                  style={[styles.recommendedTag, { backgroundColor: theme.colors.accentContainer }]}
                >
                  <Text style={[styles.recommendedText, { color: theme.colors.onAccentContainer }]}>
                    {t('advanced.clipboardAccess.sheet.recommended')}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.methodSummary, { color: theme.colors.textSecondary }]}>
              {t(`${prefix}.summary`)}
            </Text>
          </View>
        </View>

        <View style={[styles.detailDivider, { backgroundColor: theme.colors.separator }]} />
        <MethodDetail
          icon="person-outline"
          label={t('advanced.clipboardAccess.sheet.labels.bestFor')}
          value={t(`${prefix}.bestFor`)}
        />
        <MethodDetail
          icon="checkmark-circle-outline"
          label={t('advanced.clipboardAccess.sheet.labels.benefit')}
          value={t(`${prefix}.benefit`)}
        />
        <MethodDetail
          icon="alert-circle-outline"
          label={t('advanced.clipboardAccess.sheet.labels.tradeoff')}
          value={t(`${prefix}.tradeoff`)}
        />
        <MethodDetail
          icon="construct-outline"
          label={t('advanced.clipboardAccess.sheet.labels.setup')}
          value={t(`${prefix}.setup`)}
        />

        <Pressable
          onPress={handleSelect}
          disabled={selected || disabled}
          accessibilityRole="button"
          accessibilityState={{ disabled: selected || disabled }}
          style={({ pressed }) => [
            styles.primaryButton,
            {
              backgroundColor: selected ? theme.colors.surfaceHighest : theme.colors.accent,
              opacity: pressed ? 0.72 : 1,
            },
          ]}
        >
          <Ionicons
            name={selected ? 'checkmark-circle' : 'arrow-forward'}
            size={20}
            color={selected ? theme.colors.textSecondary : theme.colors.onAccent}
          />
          <Text
            style={[
              styles.primaryButtonText,
              { color: selected ? theme.colors.textSecondary : theme.colors.onAccent },
            ]}
          >
            {selected
              ? t('advanced.clipboardAccess.sheet.current')
              : t('advanced.clipboardAccess.sheet.useMethod')}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
});

function MethodDetail({ icon, label, value }: { icon: IoniconName; label: string; value: string }) {
  const { theme } = useTheme();
  return (
    <View style={styles.detailRow}>
      <Ionicons name={icon} size={20} color={theme.colors.accent} />
      <View style={styles.detailTextGroup}>
        <Text style={[styles.detailLabel, { color: theme.colors.textSecondary }]}>{label}</Text>
        <Text style={[styles.detailValue, { color: theme.colors.textPrimary }]}>{value}</Text>
      </View>
    </View>
  );
}

interface AdbSetupSheetProps {
  stage: AdbSetupStage;
  command: string;
  onCopy: () => void;
  onCheck: () => void;
  onClose: () => void;
}

const AdbSetupSheet = memo(function AdbSetupSheet({
  stage,
  command,
  onCopy,
  onCheck,
  onClose,
}: AdbSetupSheetProps) {
  const { t } = useTranslation('settingsBackground');
  const { theme } = useTheme();
  const { height: windowHeight } = useWindowDimensions();

  return (
    <View style={[styles.adbContainer, { maxHeight: getSheetContentMaxHeight(windowHeight) }]}>
      <SheetHeader
        title={t('advanced.clipboardAccess.adbGuide.title')}
        subtitle={t('advanced.clipboardAccess.adbGuide.subtitle')}
        onClose={onClose}
      />

      <ScrollView
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.adbBody}
      >
        {stage !== 'instructions' ? (
          <View
            style={[
              styles.adbStatus,
              {
                backgroundColor:
                  stage === 'copied' ? theme.colors.infoContainer : theme.colors.warningContainer,
              },
            ]}
          >
            <Ionicons
              name={stage === 'copied' ? 'copy-outline' : 'alert-circle-outline'}
              size={20}
              color={
                stage === 'copied' ? theme.colors.onInfoContainer : theme.colors.onWarningContainer
              }
            />
            <Text
              style={[
                styles.adbStatusText,
                {
                  color:
                    stage === 'copied'
                      ? theme.colors.onInfoContainer
                      : theme.colors.onWarningContainer,
                },
              ]}
            >
              {t(`advanced.clipboardAccess.adbGuide.status.${stage}`)}
            </Text>
          </View>
        ) : null}

        <View style={styles.steps}>
          {[1, 2, 3, 4].map((step) => (
            <GuideStep
              key={step}
              index={step}
              text={t(`advanced.clipboardAccess.adbGuide.step${step}`)}
            />
          ))}
        </View>

        <Text style={[styles.commandLabel, { color: theme.colors.textSecondary }]}>
          {t('advanced.clipboardAccess.adbGuide.commandLabel')}
        </Text>
        <View
          style={[
            styles.commandBox,
            { backgroundColor: theme.colors.surfaceHighest, borderColor: theme.colors.separator },
          ]}
        >
          <Text selectable style={[styles.commandText, { color: theme.colors.textPrimary }]}>
            {command}
          </Text>
        </View>

        <View style={styles.adbActions}>
          {stage === 'instructions' ? (
            <PrimarySheetButton
              icon="copy-outline"
              label={t('advanced.clipboardAccess.adbGuide.copyCommand')}
              onPress={onCopy}
            />
          ) : (
            <>
              <PrimarySheetButton
                icon="checkmark-circle-outline"
                label={t('advanced.clipboardAccess.adbGuide.check')}
                onPress={onCheck}
              />
              <Pressable onPress={onCopy} style={styles.secondaryButton} accessibilityRole="button">
                <Ionicons name="copy-outline" size={19} color={theme.colors.accent} />
                <Text style={[styles.secondaryButtonText, { color: theme.colors.accent }]}>
                  {t('advanced.clipboardAccess.adbGuide.copyAgain')}
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
});

function GuideStep({ index, text }: { index: number; text: string }) {
  const { theme } = useTheme();
  return (
    <View style={styles.guideStep}>
      <View style={[styles.stepNumber, { backgroundColor: theme.colors.accentContainer }]}>
        <Text style={[styles.stepNumberText, { color: theme.colors.onAccentContainer }]}>
          {index}
        </Text>
      </View>
      <Text style={[styles.stepText, { color: theme.colors.textPrimary }]}>{text}</Text>
    </View>
  );
}

function SheetHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('common');
  const { theme } = useTheme();
  return (
    <View style={styles.header}>
      <View style={styles.headerTextGroup}>
        <Text style={[styles.sheetTitle, { color: theme.colors.textPrimary }]}>{title}</Text>
        <Text style={[styles.sheetSubtitle, { color: theme.colors.textSecondary }]}>
          {subtitle}
        </Text>
      </View>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('action.close')}
        style={[styles.closeButton, { backgroundColor: theme.colors.surfaceHighest }]}
      >
        <Ionicons name="close" size={20} color={theme.colors.textPrimary} />
      </Pressable>
    </View>
  );
}

function PrimarySheetButton({
  icon,
  label,
  onPress,
}: {
  icon: IoniconName;
  label: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.primaryButton,
        { backgroundColor: theme.colors.accent, opacity: pressed ? 0.72 : 1 },
      ]}
    >
      <Ionicons name={icon} size={20} color={theme.colors.onAccent} />
      <Text style={[styles.primaryButtonText, { color: theme.colors.onAccent }]}>{label}</Text>
    </Pressable>
  );
}

function getMethodIcon(method: ClipboardAccessMethod): IoniconName {
  if (method === 'overlay-polling') return 'timer-outline';
  if (method === 'overlay-event') return 'terminal-outline';
  return 'layers-outline';
}

const styles = StyleSheet.create({
  sheetBody: { paddingBottom: 4 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 12,
  },
  headerTextGroup: { flex: 1, gap: 4 },
  sheetTitle: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: 0 },
  sheetSubtitle: { fontSize: 14, lineHeight: 20, letterSpacing: 0 },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  carouselContent: { paddingHorizontal: PAGE_HORIZONTAL_INSET },
  pageSeparator: { width: PAGE_GAP },
  methodPage: {
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  methodPageContent: { flexGrow: 1, padding: 18 },
  methodHeading: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  methodIcon: {
    width: 48,
    height: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodTitleGroup: { flex: 1, gap: 4 },
  methodTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  methodTitle: { fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: 0 },
  methodSummary: { fontSize: 14, lineHeight: 20, letterSpacing: 0 },
  recommendedTag: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  recommendedText: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0 },
  detailDivider: { height: StyleSheet.hairlineWidth, marginVertical: 16 },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 13 },
  detailTextGroup: { flex: 1, gap: 2 },
  detailLabel: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0 },
  detailValue: { fontSize: 14, lineHeight: 20, letterSpacing: 0 },
  primaryButton: {
    minHeight: 48,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 'auto',
  },
  primaryButtonText: { fontSize: 15, lineHeight: 20, fontWeight: '700', letterSpacing: 0 },
  pageIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 12,
  },
  pageIndicatorHitbox: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  pageIndicator: { width: 8, height: 8, borderRadius: 4 },
  adbContainer: { flexShrink: 1 },
  adbBody: { paddingHorizontal: 20, paddingBottom: 8 },
  adbStatus: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  adbStatusText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '600', letterSpacing: 0 },
  steps: { gap: 12, marginBottom: 16 },
  guideStep: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: { fontSize: 13, lineHeight: 18, fontWeight: '700', letterSpacing: 0 },
  stepText: { flex: 1, fontSize: 14, lineHeight: 21, letterSpacing: 0 },
  commandLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    marginBottom: 6,
    letterSpacing: 0,
  },
  commandBox: { borderWidth: 1, borderRadius: 8, padding: 12 },
  commandText: { fontSize: 13, lineHeight: 19, fontFamily: 'monospace', letterSpacing: 0 },
  adbActions: { gap: 8, paddingTop: 16 },
  secondaryButton: {
    minHeight: 44,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryButtonText: { fontSize: 14, lineHeight: 20, fontWeight: '600', letterSpacing: 0 },
});
