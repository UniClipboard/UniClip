import fs from 'fs';
import path from 'path';
import {
  FULL_SWIPE_RATIO,
  LEADING_ACTION_WIDTH,
  TRAILING_BUTTON_WIDTH,
  isSwipeArmed,
  resolveRowSwipe,
} from '@/components/ios/historyRowSwipe';

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');

describe('iOS history row swipe', () => {
  const width = 358;

  it('copies only after dragging past the leading button', () => {
    expect(resolveRowSwipe(LEADING_ACTION_WIDTH - 1, 0, width)).toEqual({ kind: 'close' });
    expect(resolveRowSwipe(LEADING_ACTION_WIDTH, 0, width)).toEqual({ kind: 'copy' });
  });

  it('opens the trailing buttons, or deletes on a full swipe', () => {
    expect(resolveRowSwipe(-20, 0, width)).toEqual({ kind: 'close' });
    expect(resolveRowSwipe(-TRAILING_BUTTON_WIDTH, 0, width)).toEqual({ kind: 'openTrailing' });
    expect(resolveRowSwipe(-30, -900, width)).toEqual({ kind: 'openTrailing' });
    expect(resolveRowSwipe(-width * FULL_SWIPE_RATIO, 0, width)).toEqual({ kind: 'delete' });
    // a fling back to the right closes an open row
    expect(resolveRowSwipe(-TRAILING_BUTTON_WIDTH * 2, 900, width)).toEqual({ kind: 'close' });
  });

  it('arms haptics exactly at the action thresholds', () => {
    expect(isSwipeArmed(LEADING_ACTION_WIDTH, width)).toBe(true);
    expect(isSwipeArmed(-TRAILING_BUTTON_WIDTH * 2, width)).toBe(false);
    expect(isSwipeArmed(-width * FULL_SWIPE_RATIO, width)).toBe(true);
  });
});

describe('iOS grouped history list wiring', () => {
  const row = read('components/ios/HistoryListRow.tsx');
  const home = read('screens/HomeView.ios.tsx');

  it('makes the whole row one pressable with detail, double-tap copy and context menu', () => {
    expect(row).toContain('testID={`history-row-${item.profileHash}`}');
    expect(row).toContain('onPress={handlePress}');
    expect(row).toContain('onLongPress={isSelectMode ? undefined : openContextMenu}');
    expect(row).toContain('useDoubleTap(() => onPress(item), onCopy && !isSelectMode ? copy : undefined)');
    // an open row closes on tap instead of opening the detail page
    expect(row).toMatch(/if \(swipe\.closeIfOpen\(\)\) return;\s*tap\(\);/);
  });

  it('keeps one row open at a time and disables swipes while selecting', () => {
    expect(row).toContain('Gesture.Pan()\n        .enabled(enabled)');
    expect(row).toContain('enabled: !isSelectMode');
    expect(row).toContain('if (openRow) openRow.value = rowKey;');
    expect(read('components/ios/HistoryList.tsx')).toContain("openRow.value = '';");
  });

  it('switches the home page between grid and grouped lists', () => {
    expect(home).toContain('renderCollection={getHomeHistoryCollection(home)}');
    expect(home).toContain('renderCollection={getHomeHistoryCollection(searchC)}');
    const collection = read('screens/ios/homeHistoryCollection.tsx');
    expect(collection).toContain("if (c.historyLayout === 'grid') return undefined;");
    expect(collection).toContain("c.historyLayout === 'compact' ? 'compact' : 'comfortable'");
  });
});
