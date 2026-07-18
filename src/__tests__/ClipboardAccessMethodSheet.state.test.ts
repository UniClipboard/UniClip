import { describe, expect, it, jest } from '@jest/globals';
import {
  clipboardAccessSheetReducer,
  getMethodPageHeight,
  getSheetContentMaxHeight,
  INITIAL_CLIPBOARD_ACCESS_SHEET_STATE,
  resolveAdbAuthorizationCheck,
} from '../screens/settings/ClipboardAccessMethodSheet.state';

const methodOptions = {
  selectedMethod: 'overlay-polling' as const,
  onSelect: jest.fn<(method: 'overlay-polling' | 'overlay-event' | 'shizuku') => void>(),
};

const adbOptions = {
  stage: 'instructions' as const,
  command: 'adb shell pm grant app.test android.permission.READ_LOGS',
  onCopy: jest.fn<() => void>(),
  onCheck: jest.fn<() => void>(),
};

describe('clipboard access method sheet state', () => {
  it('opens and closes the method comparison while retaining exit content', () => {
    const opened = clipboardAccessSheetReducer(INITIAL_CLIPBOARD_ACCESS_SHEET_STATE, {
      type: 'open-methods',
      options: methodOptions,
    });

    expect(opened).toMatchObject({
      visible: true,
      isSelecting: false,
      content: { type: 'methods', selectedMethod: 'overlay-polling' },
    });

    expect(clipboardAccessSheetReducer(opened, { type: 'close' })).toEqual({
      ...opened,
      visible: false,
    });
  });

  it('locks interaction while a method selection is running', () => {
    const opened = clipboardAccessSheetReducer(INITIAL_CLIPBOARD_ACCESS_SHEET_STATE, {
      type: 'open-methods',
      options: methodOptions,
    });
    const selecting = clipboardAccessSheetReducer(opened, { type: 'selection-started' });

    expect(selecting.visible).toBe(false);
    expect(selecting.isSelecting).toBe(true);
    expect(clipboardAccessSheetReducer(selecting, { type: 'selection-finished' })).toEqual({
      ...selecting,
      isSelecting: false,
    });
  });

  it('transitions from method comparison to ADB setup content', () => {
    const adb = clipboardAccessSheetReducer(INITIAL_CLIPBOARD_ACCESS_SHEET_STATE, {
      type: 'open-adb',
      options: adbOptions,
    });

    expect(adb).toMatchObject({
      visible: true,
      isSelecting: false,
      content: {
        type: 'adb',
        stage: 'instructions',
        command: adbOptions.command,
      },
    });
  });

  it('shrinks method pages for landscape windows and caps tall portrait windows', () => {
    expect(getMethodPageHeight(400)).toBe(140);
    expect(getMethodPageHeight(900)).toBe(500);
    expect(getMethodPageHeight(240)).toBe(72);
    expect(getSheetContentMaxHeight(400)).toBe(332);
  });
});

describe('ADB authorization check outcome', () => {
  it('completes only when both clipboard access and event monitoring are ready', () => {
    expect(resolveAdbAuthorizationCheck({ status: 'ready', monitoringStatus: 'ready' })).toBe(
      'complete'
    );
  });

  it('keeps the ADB guide open while READ_LOGS is missing', () => {
    expect(
      resolveAdbAuthorizationCheck({
        status: 'ready',
        monitoringStatus: 'setup-required',
        setupCommand: adbOptions.command,
      })
    ).toBe('show-adb-guide');
  });

  it('returns to access setup when READ_LOGS exists but overlay permission is missing', () => {
    expect(
      resolveAdbAuthorizationCheck({ status: 'unauthorized', monitoringStatus: 'ready' })
    ).toBe('continue-access-setup');
  });
});
