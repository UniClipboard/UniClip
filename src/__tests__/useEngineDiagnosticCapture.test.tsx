import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
const mockQuery = jest.fn();
const mockStart = jest.fn();
const mockStop = jest.fn();
jest.mock('uc-engine', () => ({ getEngineDiagnosticStatus: () => mockQuery(), startEngineDiagnosticCapture: (ms: number) => mockStart(ms), stopEngineDiagnosticCapture: (id: string) => mockStop(id) }));
jest.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: () => ({remove: jest.fn()}) } }));
import { useEngineDiagnosticCapture } from '../support/diagnostics/useEngineDiagnosticCapture';
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let state: ReturnType<typeof useEngineDiagnosticCapture>;
function Harness() { state = useEngineDiagnosticCapture(); return null; }
const status = (mode = 'standard', id: string | null = null, remainingMs = 0) => ({localFile: 'ready', closed: false, capture: {mode, captureId: id, remainingMs}});
let renderer: TestRenderer.ReactTestRenderer;
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); mockQuery.mockResolvedValue(status()); });
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); jest.useRealTimers(); });
it('starts ten minutes, restores Engine state on revisit, and stops the specific capture', async () => {
 await act(async () => {renderer = TestRenderer.create(<Harness />);});
 mockStart.mockImplementation(async () => { mockQuery.mockResolvedValue(status('detailed', 'capture-1', 600000)); });
 await act(async () => { await state.toggle(); });
 expect(mockStart).toHaveBeenCalledWith(600000);
 expect(state.active).toBe(true);
 await act(async () => { renderer.unmount(); });
 expect(mockStop).not.toHaveBeenCalled();
 await act(async () => { renderer = TestRenderer.create(<Harness />); });
 expect(state.remainingMinutes).toBe(10);
 mockStop.mockImplementation(async () => { mockQuery.mockResolvedValue(status()); });
 await act(async () => { await state.toggle(); });
 expect(mockStop).toHaveBeenCalledWith('capture-1');
 expect(state.active).toBe(false);
});
it('refreshes expiry without starting another capture', async () => {
 mockQuery.mockResolvedValue(status('detailed', 'capture-1', 1000));
 await act(async () => { renderer = TestRenderer.create(<Harness />); });
 mockQuery.mockResolvedValue(status());
 await act(async () => {jest.advanceTimersByTime(2000);});
 expect(state.active).toBe(false);
 expect(mockStart).not.toHaveBeenCalled();
});
it('reports unavailable and operation failure without exposing native error text', async () => {
 mockQuery.mockRejectedValue(new Error('private native reason'));
 await act(async () => { renderer = TestRenderer.create(<Harness />); });
 expect(state.available).toBe(false);
 mockQuery.mockResolvedValue(status());
 await act(async () => {jest.advanceTimersByTime(2000);});
 mockStart.mockRejectedValue(new Error('private native reason'));
 await act(async () => {await state.toggle();});
 expect(state.failed).toBe(true);
 expect(JSON.stringify(state)).not.toContain('private');
});
it('accepts a user action while a status refresh is waiting and ignores the stale result', async () => {
 await act(async () => { renderer = TestRenderer.create(<Harness />); });
 let finishRefresh!: (value: unknown) => void;
 mockQuery.mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve; }));
 await act(async () => {jest.advanceTimersByTime(2000);});
 mockStart.mockResolvedValue(undefined);
 mockQuery.mockResolvedValue(status('detailed', 'capture-new', 600000));
 await act(async () => {await state.toggle();});
 expect(mockStart).toHaveBeenCalledWith(600000);
 await act(async () => {finishRefresh(status());});
 expect(state.active).toBe(true);
});

it('clears pending state after failure and lets an in-flight request finish after unmount', async () => {
 await act(async () => { renderer = TestRenderer.create(<Harness />); });
 let reject!: (error: Error) => void;
 mockStart.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
 let pending!: Promise<void>;
 await act(async () => { pending = state.toggle(); });
 expect(state.busy).toBe(true);
 expect(state.failed).toBe(false);
 await act(async () => { reject(new Error('unavailable')); await pending; });
 expect(state.busy).toBe(false);
 expect(state.failed).toBe(true);
 await act(async () => { pending = state.toggle(); });
 await act(async () => { renderer.unmount(); });
 await act(async () => { reject(new Error('unavailable')); await pending; });
 expect(mockStop).not.toHaveBeenCalled();
});
