import type { AndroidSettings } from '@/types/settings';

export interface BackgroundClipboardEvent {
  type: 'text' | 'image' | 'files';
  content: string;
  mimeType?: string;
  displayName?: string;
}

export interface BackgroundClipboardMonitor {
  remove(): void;
}

export type BackgroundClipboardOperation = 'monitor' | 'read' | 'write';

export interface ClipboardAuthorizationState {
  status: 'ready' | 'unavailable' | 'unauthorized' | 'incompatible';
  monitoringStatus: 'ready' | 'setup-required';
  setupUrl?: string;
  setupCommand?: string;
}

export type BackgroundClipboardSetupIssue =
  | 'service-unavailable'
  | 'permission-required'
  | 'system-restriction'
  | 'monitoring-setup-required';

export interface BackgroundClipboardSetupState {
  status: 'ready' | 'action-required';
  issue: BackgroundClipboardSetupIssue | null;
}

export type BackgroundClipboardSetupActionResult =
  | 'completed'
  | 'waiting-for-return'
  | 'command-copied'
  | 'no-action'
  | 'failed';

const BACKGROUND_CLIPBOARD_METHODS: AndroidSettings['clipboardAccessMethod'][] = [
  'shizuku',
  'overlay',
];

export function getBackgroundClipboardSetupState(
  state: ClipboardAuthorizationState
): BackgroundClipboardSetupState {
  if (state.status === 'unavailable') {
    return { status: 'action-required', issue: 'service-unavailable' };
  }
  if (state.status === 'unauthorized') {
    return { status: 'action-required', issue: 'permission-required' };
  }
  if (state.status === 'incompatible') {
    return { status: 'action-required', issue: 'system-restriction' };
  }
  if (state.monitoringStatus === 'setup-required') {
    return { status: 'action-required', issue: 'monitoring-setup-required' };
  }
  return { status: 'ready', issue: null };
}

export function getAlternativeClipboardMethod(
  currentMethod: AndroidSettings['clipboardAccessMethod']
): AndroidSettings['clipboardAccessMethod'] {
  return BACKGROUND_CLIPBOARD_METHODS.find((method) => method !== currentMethod) ?? currentMethod;
}

interface ShizukuAuthorizationInputs {
  available: boolean;
  authorized: boolean;
  restricted: boolean;
}

export function getShizukuAuthorizationState({
  available,
  authorized,
  restricted,
}: ShizukuAuthorizationInputs): ClipboardAuthorizationState {
  if (restricted) {
    return { status: 'incompatible', monitoringStatus: 'setup-required' };
  }
  if (!available) {
    return {
      status: 'unavailable',
      monitoringStatus: 'setup-required',
      setupUrl: 'https://shizuku.rikka.app/guide/setup/',
    };
  }
  return {
    status: authorized ? 'ready' : 'unauthorized',
    monitoringStatus: authorized ? 'ready' : 'setup-required',
  };
}

export interface BackgroundClipboardAdapter {
  readonly method: AndroidSettings['clipboardAccessMethod'];
  isReady(operation: BackgroundClipboardOperation): boolean;
  startMonitoring(
    listener: (event: BackgroundClipboardEvent) => void
  ): Promise<BackgroundClipboardMonitor | null>;
  runTriggeredRead<T>(read: () => Promise<T>): Promise<T>;
  getString(): Promise<string>;
  setString(text: string): Promise<boolean>;
  hasString(): Promise<boolean>;
  hasImage(): Promise<boolean>;
  saveImageToFile(destDirPath: string): Promise<{ filePath: string; mimeType: string } | null>;
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  addAuthorizationChangeListener(listener: () => void): BackgroundClipboardMonitor;
  getAuthorizationState(): ClipboardAuthorizationState;
  requestAuthorization(): boolean;
  continueSetup(): Promise<BackgroundClipboardSetupActionResult>;
}

type ClipboardAdapterRegistry = Record<
  AndroidSettings['clipboardAccessMethod'],
  BackgroundClipboardAdapter
>;

interface SelectBackgroundClipboardAdapterOptions {
  selectedMethod: AndroidSettings['clipboardAccessMethod'];
  appIsBackground: boolean;
  operation: BackgroundClipboardOperation;
  adapters: ClipboardAdapterRegistry;
}

interface ChangeBackgroundClipboardMethodOptions {
  currentMethod: AndroidSettings['clipboardAccessMethod'];
  nextMethod: AndroidSettings['clipboardAccessMethod'];
  adapters: ClipboardAdapterRegistry;
  persist(method: AndroidSettings['clipboardAccessMethod']): Promise<void>;
  restart(): Promise<void>;
}

export function getClipboardAdapter(
  method: AndroidSettings['clipboardAccessMethod'],
  adapters: ClipboardAdapterRegistry
): BackgroundClipboardAdapter {
  return adapters[method];
}

export function selectBackgroundClipboardAdapter({
  selectedMethod,
  appIsBackground,
  operation,
  adapters,
}: SelectBackgroundClipboardAdapterOptions): BackgroundClipboardAdapter | null {
  if (operation !== 'monitor' && !appIsBackground) return null;
  const selected = getClipboardAdapter(selectedMethod, adapters);
  return selected.isReady(operation) ? selected : null;
}

export async function changeBackgroundClipboardMethod({
  currentMethod,
  nextMethod,
  adapters,
  persist,
  restart,
}: ChangeBackgroundClipboardMethodOptions): Promise<BackgroundClipboardSetupActionResult> {
  if (currentMethod === nextMethod) return 'no-action';

  const current = getClipboardAdapter(currentMethod, adapters);
  const next = getClipboardAdapter(nextMethod, adapters);
  await current.deactivate();
  try {
    await persist(nextMethod);
    await next.activate();
    await restart();
    return next.continueSetup();
  } catch (error) {
    await current.activate();
    throw error;
  }
}

export async function refreshBackgroundClipboardAuthorization(
  adapter: BackgroundClipboardAdapter,
  publish: (state: ClipboardAuthorizationState) => void,
  restart: () => Promise<void>
): Promise<void> {
  publish(adapter.getAuthorizationState());
  await restart();
}
