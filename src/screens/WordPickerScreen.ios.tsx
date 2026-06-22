import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Modal,
  Pressable,
  PlatformColor,
  DynamicColorIOS,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Segment, useDefault } from 'segmentit';
import type { WordPickerScreenProps } from './WordPickerScreen.types';

let segmentInstance: Segment | null = null;
function getSegment(): Segment {
  if (!segmentInstance) {
    segmentInstance = useDefault(new Segment());
  }
  return segmentInstance;
}

function tokenize(text: string): string[] {
  const seg = getSegment();
  return seg.doSegment(text).map((t) => t.w);
}

function tokenizeByChar(text: string): string[] {
  const regex = /[a-zA-Z0-9]+|[\s]+|./g;
  return text.match(regex) || [];
}

function tokenPositions(tokens: string[]): Array<[number, number]> {
  const positions: Array<[number, number]> = [];
  let offset = 0;
  for (const t of tokens) {
    positions.push([offset, offset + t.length]);
    offset += t.length;
  }
  return positions;
}

const MAX_CHIP_CHARS = 4000;

const chipSelectedBg = DynamicColorIOS({ light: '#15171C', dark: '#F4F2EE' });
const chipSelectedText = DynamicColorIOS({ light: '#F4F2EE', dark: '#15171C' });
const segmentActiveBg = DynamicColorIOS({ light: '#fff', dark: 'rgba(99,99,102,0.55)' });
const segmentActiveText = DynamicColorIOS({ light: '#000', dark: '#fff' });

export const WordPickerScreen: React.FC<WordPickerScreenProps> = ({ text, onComplete }) => {
  const [useChars, setUseChars] = useState(false);
  const chipsAvailable = text.length <= MAX_CHIP_CHARS;

  const tokens = useMemo(
    () => (useChars ? tokenizeByChar(text) : tokenize(text)),
    [text, useChars],
  );

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);
  const prevTokensRef = useRef<string[]>(tokens);
  const prevSelectedRef = useRef<Set<number>>(selected);
  prevSelectedRef.current = selected;

  React.useEffect(() => {
    const prevTokens = prevTokensRef.current;
    const prevSelected = prevSelectedRef.current;
    prevTokensRef.current = tokens;
    if (prevSelected.size === 0) return;

    const oldPositions = tokenPositions(prevTokens);
    const selectedChars = new Set<number>();
    for (const idx of prevSelected) {
      if (idx < oldPositions.length) {
        const [start, end] = oldPositions[idx];
        for (let c = start; c < end; c++) selectedChars.add(c);
      }
    }
    const newPositions = tokenPositions(tokens);
    const newSelected = new Set<number>();
    newPositions.forEach(([start, end], i) => {
      for (let c = start; c < end; c++) {
        if (selectedChars.has(c)) { newSelected.add(i); break; }
      }
    });
    setSelected(newSelected);
  }, [tokens]);

  // --- Drag selection state ---
  const chipFrames = useRef<Map<number, { x: number; y: number; w: number; h: number }>>(new Map());
  const scrollOffsetRef = useRef(0);
  const containerLayoutRef = useRef({ x: 0, y: 0 });
  const dragAnchor = useRef<number | null>(null);
  const dragLastFocus = useRef<number | null>(null);
  const didDrag = useRef(false);

  const hitTestChip = useCallback((pageX: number, pageY: number): number | null => {
    const cx = pageX - containerLayoutRef.current.x;
    const cy = pageY - containerLayoutRef.current.y + scrollOffsetRef.current;
    for (const [idx, frame] of chipFrames.current.entries()) {
      if (cx >= frame.x && cx <= frame.x + frame.w && cy >= frame.y && cy <= frame.y + frame.h) {
        return idx;
      }
    }
    return null;
  }, []);

  const handleLongPress = useCallback((index: number) => {
    didDrag.current = true;
    dragAnchor.current = index;
    dragLastFocus.current = index;
    setSelected((prev) => new Set(prev).add(index));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, []);

  const handleTouchMove = useCallback((e: GestureResponderEvent) => {
    if (dragAnchor.current === null) return;
    const { pageX, pageY } = e.nativeEvent;
    const idx = hitTestChip(pageX, pageY);
    if (idx === null || idx === dragLastFocus.current) return;

    const anchor = dragAnchor.current;
    const lo = Math.min(anchor, idx);
    const hi = Math.max(anchor, idx);

    setSelected((prev) => {
      const next = new Set(prev);
      let addedNew = false;
      for (let k = lo; k <= hi; k++) {
        if (!/^\s+$/.test(tokens[k]) && !next.has(k)) {
          next.add(k);
          addedNew = true;
        }
      }
      if (addedNew) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      return next;
    });
    dragLastFocus.current = idx;
  }, [tokens, hitTestChip]);

  const handleTouchEnd = useCallback(() => {
    dragAnchor.current = null;
    dragLastFocus.current = null;
    setTimeout(() => { didDrag.current = false; }, 50);
  }, []);

  const toggleToken = useCallback((index: number) => {
    if (didDrag.current) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    const all = new Set<number>();
    tokens.forEach((t, i) => { if (!/^\s+$/.test(t)) all.add(i); });
    setSelected(all);
  }, [tokens]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const selectedText = useMemo(() => {
    if (selected.size === 0) return '';
    const sorted = [...selected].sort((a, b) => a - b);
    const runs: string[] = [];
    let runStart = sorted[0];
    let prev = sorted[0];
    for (const idx of sorted.slice(1)) {
      if (idx === prev + 1) { prev = idx; continue; }
      runs.push(tokens.slice(runStart, prev + 1).join(''));
      runStart = idx;
      prev = idx;
    }
    runs.push(tokens.slice(runStart, prev + 1).join(''));
    return runs.join('\n');
  }, [selected, tokens]);

  const handleCopy = useCallback(async () => {
    if (!selectedText) return;
    try {
      await Clipboard.setStringAsync(selectedText);
    } catch {
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [selectedText]);

  const selectedCount = selected.size;

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onComplete}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>选择文本</Text>
          <Pressable onPress={onComplete} hitSlop={8}>
            <Text style={styles.doneButton}>完成</Text>
          </Pressable>
        </View>

        {/* Segmented control */}
        {chipsAvailable && (
          <View style={styles.segmentRow}>
            <View style={styles.segmentContainer}>
              <Pressable
                style={[styles.segmentItem, !useChars && styles.segmentItemActive]}
                onPress={() => setUseChars(false)}
              >
                <Text style={[styles.segmentText, !useChars && styles.segmentTextActive]}>
                  分词
                </Text>
              </Pressable>
              <Pressable
                style={[styles.segmentItem, useChars && styles.segmentItemActive]}
                onPress={() => setUseChars(true)}
              >
                <Text style={[styles.segmentText, useChars && styles.segmentTextActive]}>
                  逐字
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Control row */}
        <View style={styles.controlRow}>
          <Text style={styles.countLabel}>
            {selectedCount > 0 ? `已选 ${selectedCount} 词` : '未选择'}
          </Text>
          <View style={styles.controlButtons}>
            <Pressable onPress={selectAll} hitSlop={4} disabled={tokens.length === 0}>
              <Text style={[styles.controlAction, { opacity: tokens.length > 0 ? 1 : 0.35 }]}>
                全选
              </Text>
            </Pressable>
            <Pressable onPress={clearSelection} hitSlop={4} disabled={selectedCount === 0}>
              <Text style={[styles.controlActionSecondary, { opacity: selectedCount > 0 ? 1 : 0.35 }]}>
                清空
              </Text>
            </Pressable>
            <Pressable
              onPress={handleCopy}
              disabled={selectedCount === 0 || copied}
              style={[styles.copyButton, { opacity: selectedCount > 0 ? 1 : 0.35 }]}
            >
              <Text style={styles.copyButtonText}>{copied ? '已复制 ✓' : '复制选中'}</Text>
            </Pressable>
          </View>
        </View>

        {/* Chip flow */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.chipContainer}
          onScroll={(e) => { scrollOffsetRef.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
        >
          <View
            style={styles.chipFlow}
            onLayout={(e: LayoutChangeEvent) => {
              e.target.measureInWindow((x, y) => {
                containerLayoutRef.current = { x, y };
              });
            }}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => dragAnchor.current !== null}
            onResponderMove={handleTouchMove}
            onResponderRelease={handleTouchEnd}
          >
            {tokens.map((token, index) => {
              const isWhitespace = /^\s+$/.test(token);
              if (isWhitespace) {
                return <View key={index} style={styles.whitespace} />;
              }
              const isSelected = selected.has(index);
              return (
                <ChipItem
                  key={index}
                  index={index}
                  token={token}
                  isSelected={isSelected}
                  onPress={toggleToken}
                  onLongPress={handleLongPress}
                  onLayout={(idx, layout) => { chipFrames.current.set(idx, layout); }}
                />
              );
            })}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
};

interface ChipItemProps {
  index: number;
  token: string;
  isSelected: boolean;
  onPress: (index: number) => void;
  onLongPress: (index: number) => void;
  onLayout: (index: number, layout: { x: number; y: number; w: number; h: number }) => void;
}

const ChipItem = React.memo(function ChipItem({
  index,
  token,
  isSelected,
  onPress,
  onLongPress,
  onLayout,
}: ChipItemProps) {
  return (
    <Pressable
      onPress={() => onPress(index)}
      onLongPress={() => onLongPress(index)}
      delayLongPress={300}
      onLayout={(e) => {
        const { x, y, width, height } = e.nativeEvent.layout;
        onLayout(index, { x, y, w: width, h: height });
      }}
      style={[
        styles.chip,
        isSelected ? styles.chipSelected : styles.chipDefault,
      ]}
    >
      <Text
        style={[styles.chipText, isSelected ? styles.chipTextSelected : styles.chipTextDefault]}
        numberOfLines={1}
      >
        {token}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: PlatformColor('systemBackground'),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: PlatformColor('label'),
  },
  doneButton: {
    fontSize: 17,
    fontWeight: '600',
    color: chipSelectedBg,
  },
  segmentRow: {
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  segmentContainer: {
    flexDirection: 'row',
    borderRadius: 8,
    padding: 2,
    backgroundColor: PlatformColor('tertiarySystemFill'),
  },
  segmentItem: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
  },
  segmentItemActive: {
    backgroundColor: segmentActiveBg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
  },
  segmentTextActive: {
    color: segmentActiveText,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  countLabel: {
    fontSize: 13,
    color: PlatformColor('secondaryLabel'),
  },
  controlButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  controlAction: {
    fontSize: 15,
    fontWeight: '500',
    color: chipSelectedBg,
  },
  controlActionSecondary: {
    fontSize: 15,
    fontWeight: '500',
    color: PlatformColor('secondaryLabel'),
  },
  copyButton: {
    backgroundColor: chipSelectedBg,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
  },
  copyButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: chipSelectedText,
  },
  scrollView: {
    flex: 1,
  },
  chipContainer: {
    padding: 16,
  },
  chipFlow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  whitespace: {
    width: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    maxWidth: 260,
  },
  chipDefault: {
    backgroundColor: PlatformColor('tertiarySystemFill'),
  },
  chipSelected: {
    backgroundColor: chipSelectedBg,
  },
  chipText: {
    fontSize: 16,
    lineHeight: 20,
  },
  chipTextDefault: {
    color: PlatformColor('label'),
  },
  chipTextSelected: {
    color: chipSelectedText,
  },
});
