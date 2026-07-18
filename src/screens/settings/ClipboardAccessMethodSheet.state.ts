import {
  getBackgroundClipboardSetupState,
  type ClipboardAuthorizationState,
} from '@/utils/backgroundClipboardAccess';
import type {
  OpenAdbSetupSheetOptions,
  OpenClipboardAccessMethodSheetOptions,
} from './ClipboardAccessMethodSheet.types';

export type ClipboardAccessSheetContent =
  | ({ type: 'methods' } & OpenClipboardAccessMethodSheetOptions)
  | ({ type: 'adb' } & OpenAdbSetupSheetOptions);

export interface ClipboardAccessSheetState {
  visible: boolean;
  content: ClipboardAccessSheetContent | null;
  isSelecting: boolean;
}

export const INITIAL_CLIPBOARD_ACCESS_SHEET_STATE: ClipboardAccessSheetState = {
  visible: false,
  content: null,
  isSelecting: false,
};

export type ClipboardAccessSheetAction =
  | { type: 'open-methods'; options: OpenClipboardAccessMethodSheetOptions }
  | { type: 'open-adb'; options: OpenAdbSetupSheetOptions }
  | { type: 'close' }
  | { type: 'selection-started' }
  | { type: 'selection-finished' };

export function clipboardAccessSheetReducer(
  state: ClipboardAccessSheetState,
  action: ClipboardAccessSheetAction
): ClipboardAccessSheetState {
  switch (action.type) {
    case 'open-methods':
      return { visible: true, content: { type: 'methods', ...action.options }, isSelecting: false };
    case 'open-adb':
      return { visible: true, content: { type: 'adb', ...action.options }, isSelecting: false };
    case 'close':
      return { ...state, visible: false };
    case 'selection-started':
      return { ...state, visible: false, isSelecting: true };
    case 'selection-finished':
      return { ...state, isSelecting: false };
  }
}

const SHEET_MAX_HEIGHT_RATIO = 0.9;
const SHEET_HANDLE_HEIGHT = 28;
const METHOD_SHEET_CHROME_HEIGHT = 220;
const MIN_METHOD_PAGE_HEIGHT = 72;
const MAX_METHOD_PAGE_HEIGHT = 500;

export function getMethodPageHeight(windowHeight: number): number {
  return Math.max(
    MIN_METHOD_PAGE_HEIGHT,
    Math.min(
      MAX_METHOD_PAGE_HEIGHT,
      windowHeight * SHEET_MAX_HEIGHT_RATIO - METHOD_SHEET_CHROME_HEIGHT
    )
  );
}

export function getSheetContentMaxHeight(windowHeight: number): number {
  return windowHeight * SHEET_MAX_HEIGHT_RATIO - SHEET_HANDLE_HEIGHT;
}

export type AdbAuthorizationCheckOutcome = 'complete' | 'show-adb-guide' | 'continue-access-setup';

export function resolveAdbAuthorizationCheck(
  state: ClipboardAuthorizationState
): AdbAuthorizationCheckOutcome {
  const setupState = getBackgroundClipboardSetupState(state);
  if (setupState.status === 'ready') return 'complete';
  return setupState.issue === 'monitoring-setup-required'
    ? 'show-adb-guide'
    : 'continue-access-setup';
}
