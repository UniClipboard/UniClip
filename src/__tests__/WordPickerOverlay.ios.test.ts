import fs from 'fs';
import path from 'path';

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');

describe('iOS word picker page', () => {
  const page = read('components/WordPickerOverlay.ios.tsx');
  const hook = read('hooks/useWordPicker.ts');

  it('reuses the shared picker interactions and pushes in as a full-width page', () => {
    expect(page).toContain('useWordPicker(text, page.close, PICKER_OPTIONS)');
    expect(page).toContain("holdMode: 'range'");
    expect(page).toContain('usePagePushTransition(onDismiss, () => beginRef.current(), 1)');
    expect(page).toContain('<GestureDetector gesture={picker.paintGesture}>');
  });

  it('draws system-style handles with the start knob above the first word', () => {
    expect(page).toContain("startEdge: 'top'");
    expect(hook).toMatch(
      /handles\.startEdge === 'top'\s*\? start\.y - handles\.offsetY\s*: start\.y \+ start\.height \+ handles\.offsetY/
    );
    expect(page).toContain('top: -(HANDLE_OFFSET_Y + HANDLE_KNOB / 2)');
  });

  it('switches granularity and join mode with native segmented pickers', () => {
    expect(page.match(/pickerStyle\('segmented'\)/g)).toHaveLength(2);
    expect(page).toContain('picker.setGranularity(');
    expect(page).toContain('picker.setJoinMode(value as CopyJoinMode)');
    // the join mode only matters for non-contiguous selections
    expect(page).toContain('picker.runs.length > 1 ?');
  });

  it('keeps search, share and copy in the floating panel; the expanded preview drops search', () => {
    expect(page).toContain('showSearch={!expanded}');
    for (const id of ['word-picker-search', 'word-picker-share', 'word-picker-copy', 'word-picker-editor']) {
      expect(page).toContain(`testID="${id}"`);
    }
  });
});
