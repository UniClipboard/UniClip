import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type { ClipboardItem } from '@/types/clipboard';
import { recordHistoryLatency, recordHistoryViewable, type FileReadTrace } from './historyLatency';

/** Viewability plus a JS frame opportunity, not a display presentation timestamp. */
export function useHistoryViewability() {
  const focused = useIsFocused();
  const [appState, setAppState] = useState(AppState.currentState);
  const visible = useRef<ClipboardItem[]>([]);
  const pending = useRef(new Map<FileReadTrace, number>());
  const active = focused && appState === 'active';

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  const report = useCallback((items: ClipboardItem[]) => {
    visible.current = items;
    for (const [trace, frame] of pending.current) {
      if (!items.some(item => recordIdentity(item) === recordIdentityForTrace(trace))) {
        cancelAnimationFrame(frame);
        trace.visible = false;
        pending.current.delete(trace);
      }
    }
    if (!active) return;
    for (const item of items) {
      const trace = recordHistoryViewable(item);
      if (!trace) continue;
      identities.set(trace, recordIdentity(item));
      pending.current.set(trace, requestAnimationFrame(() => {
        pending.current.delete(trace);
        recordHistoryLatency('history_frame_candidate', trace, { outcome: 'observed' });
      }));
    }
  }, [active]);

  useEffect(() => {
    report(visible.current);
    const frames = pending.current;
    return () => {
      for (const [trace, frame] of frames) {
        cancelAnimationFrame(frame);
        trace.visible = false;
      }
      frames.clear();
    };
  }, [report]);
  return report;
}

const identities = new WeakMap<FileReadTrace, string>();
const recordIdentity = (item: ClipboardItem) => (item.localClipboardHash ?? item.profileHash).toUpperCase();
const recordIdentityForTrace = (trace: FileReadTrace) => identities.get(trace);
