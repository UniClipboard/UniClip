import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReceiveItem, ReceiveProgress } from 'uc-engine';
import { describeReceiveEntry } from '../features/transfer/internal/receiveResults';
import { useReceiveResultsStore } from '../stores/receiveResultsStore';

const mockService = {
  retry: jest.fn(),
  cancel: jest.fn(),
  refresh: jest.fn(async () => undefined),
};

jest.mock('@/features/transfer', () => ({
  getReceiveResultsService: () => mockService,
}));
jest.mock('@/support/observability', () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && !('ns' in options && Object.keys(options).length === 1)
        ? `${key}:${JSON.stringify(options)}`
        : key,
  }),
}));
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => 'Icon' }));
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: { colors: new Proxy({}, { get: () => '#000000' }) } }),
}));
jest.mock('@/components/ui', () => {
  const { Pressable, Text, View } = require('react-native');
  return {
    AppBottomSheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
      visible ? <View testID="app-bottom-sheet">{children}</View> : null,
    AppButton: ({
      title,
      onPress,
      disabled,
      testID,
    }: {
      title: string;
      onPress: () => void;
      disabled?: boolean;
      testID?: string;
    }) => (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled }}
        onPress={disabled ? undefined : onPress}
      >
        <Text>{title}</Text>
      </Pressable>
    ),
  };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function item(
  itemId: string,
  state: string,
  failureReason: string | null = null,
  kind = 'file'
): ReceiveItem {
  return { itemId, kind, state, failureReason };
}

function progress(
  state: string,
  items: ReceiveItem[],
  overrides: Partial<ReceiveProgress> = {}
): ReceiveProgress {
  return {
    entryId: 'entry-1',
    attemptId: 'attempt-1',
    state,
    totalBytes: 300,
    completedBytes: 100,
    itemsTotal: items.length,
    itemsCompleted: items.filter((candidate) => candidate.state === 'completed').length,
    items,
    ...overrides,
  };
}

function publish(
  ...entries: ReceiveProgress[]
): void {
  useReceiveResultsStore.setState(
    {
      entries: Object.fromEntries(
        entries.map((entry) => [entry.entryId, describeReceiveEntry(entry)])
      ),
      stale: false,
      error: null,
    },
    true
  );
}

type Platform = 'android' | 'ios';

function loadSheet(platform: Platform) {
  return require(`../components/ReceiveResultsSheet/ReceiveResultsSheet.${platform}`)
    .ReceiveResultsSheet as React.ComponentType<{ visible: boolean; onClose: () => void }>;
}

const mounted: TestRenderer.ReactTestRenderer[] = [];

async function mount(platform: Platform, onClose = jest.fn()) {
  const Sheet = loadSheet(platform);
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<Sheet visible onClose={onClose} />);
  });
  mounted.push(renderer);
  return renderer;
}

// The outermost element carrying the test id is the one the screen author wrote.
const byTestId = (renderer: TestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAll(
    (node) => node.props.testID === testID && node.parent?.props.testID !== testID
  );

function textOf(renderer: TestRenderer.ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

describe.each<Platform>(['android', 'ios'])('ReceiveResultsSheet (%s)', (platform) => {
  afterEach(async () => {
    await act(async () => {
      for (const renderer of mounted.splice(0)) renderer.unmount();
    });
  });

  beforeEach(() => {
    mockService.retry.mockReset();
    mockService.cancel.mockReset();
    mockService.refresh.mockClear();
    publish();
  });

  it('shows one row per item with its own state, and keeps saved items apart from failures', async () => {
    publish(
      progress('failed', [
        item('a', 'completed'),
        item('b', 'failed', 'storage_unavailable'),
        item('c', 'cancelled'),
      ])
    );
    const renderer = await mount(platform);

    const json = textOf(renderer);
    expect(byTestId(renderer, 'receive-item-entry-1-a')).toHaveLength(1);
    expect(byTestId(renderer, 'receive-item-entry-1-b')).toHaveLength(1);
    expect(byTestId(renderer, 'receive-item-entry-1-c')).toHaveLength(1);
    expect(json).toContain('receive.state.completed');
    expect(json).toContain('receive.state.failed');
    expect(json).toContain('receive.state.cancelled');
    expect(json).toContain('receive.reason.storage_unavailable');
  });

  it('makes the whole row the tap target for a retryable item and never for a saved item', async () => {
    publish(
      progress('failed', [item('a', 'completed'), item('b', 'failed', 'timed_out')])
    );
    const renderer = await mount(platform);

    const saved = byTestId(renderer, 'receive-item-entry-1-a')[0];
    const failed = byTestId(renderer, 'receive-item-entry-1-b')[0];
    expect(saved.props.onPress).toBeUndefined();
    expect(failed.props.accessibilityRole).toBe('checkbox');
    expect(typeof failed.props.onPress).toBe('function');
    // The row itself is the pressable, with no inner label-only press target.
    const innerPressables = failed.findAll(
      (node) => node !== failed && typeof node.props.onPress === 'function'
    );
    expect(innerPressables).toHaveLength(0);
    expect(failed.props.accessibilityState).toMatchObject({ checked: false });

    await act(async () => failed.props.onPress());
    expect(byTestId(renderer, 'receive-item-entry-1-b')[0].props.accessibilityState).toMatchObject(
      { checked: true }
    );
  });

  it('retries only the selected items of the current attempt', async () => {
    mockService.retry.mockResolvedValue({ kind: 'accepted', attemptId: 'attempt-2' });
    publish(
      progress('failed', [
        item('a', 'completed'),
        item('b', 'failed', 'timed_out'),
        item('c', 'failed', 'interrupted'),
      ])
    );
    const renderer = await mount(platform);

    expect(byTestId(renderer, 'receive-retry-entry-1')[0].props.disabled).toBe(true);
    await act(async () => byTestId(renderer, 'receive-item-entry-1-c')[0].props.onPress());
    await act(async () => byTestId(renderer, 'receive-retry-entry-1')[0].props.onPress());

    expect(mockService.retry).toHaveBeenCalledWith('entry-1', ['c']);
    // Accepted is a new attempt, not a saved file.
    expect(textOf(renderer)).toContain('receive.notice.retryAccepted');
    expect(textOf(renderer)).not.toContain('receive.notice.saved');
  });

  it('keeps one selectable unit for a directory', async () => {
    publish(
      progress(
        'failed',
        [item('directory_unit', 'failed', 'integrity_check_failed', 'directory_unit')],
        { itemsTotal: 5, itemsCompleted: 2 }
      )
    );
    const renderer = await mount(platform);

    expect(byTestId(renderer, 'receive-item-entry-1-directory_unit')).toHaveLength(1);
    expect(textOf(renderer)).toContain('receive.item.directory');
    expect(textOf(renderer)).not.toContain('"index":5');
  });

  it('offers cancel, not retry, while the attempt is still running', async () => {
    mockService.cancel.mockResolvedValue('cancellation_incomplete');
    publish(progress('receiving', [item('a', 'transferring')]))
    const renderer = await mount(platform);

    expect(byTestId(renderer, 'receive-retry-entry-1')).toHaveLength(0);
    await act(async () => byTestId(renderer, 'receive-cancel-entry-1')[0].props.onPress());

    expect(mockService.cancel).toHaveBeenCalledWith('entry-1');
    expect(textOf(renderer)).toContain('receive.notice.cancellationIncomplete');
    expect(textOf(renderer)).not.toContain('receive.notice.cancelled');
  });

  it('says cancelled only when the Engine confirmed it', async () => {
    mockService.cancel.mockResolvedValue('cancelled');
    publish(progress('receiving', [item('a', 'transferring')]));
    const renderer = await mount(platform);

    await act(async () => byTestId(renderer, 'receive-cancel-entry-1')[0].props.onPress());

    expect(textOf(renderer)).toContain('receive.notice.cancelled');
  });

  it.each([
    ['alreadyReceiving', 'receive.notice.alreadyReceiving'],
    ['superseded', 'receive.notice.superseded'],
    ['cancellationIncomplete', 'receive.notice.retryCancellationIncomplete'],
  ])('explains the %s retry outcome', async (kind, notice) => {
    mockService.retry.mockResolvedValue({ kind });
    publish(progress('failed', [item('b', 'failed', 'timed_out')]));
    const renderer = await mount(platform);

    await act(async () => byTestId(renderer, 'receive-item-entry-1-b')[0].props.onPress());
    await act(async () => byTestId(renderer, 'receive-retry-entry-1')[0].props.onPress());

    expect(textOf(renderer)).toContain(notice);
  });

  it.each([
    ['source_unavailable', 'receive.notice.sourceUnavailable'],
    ['access_denied', 'receive.notice.accessDenied'],
  ])('shows %s without claiming a retry started', async (reason, notice) => {
    mockService.retry.mockResolvedValue({ kind: 'unavailable', reason });
    publish(progress('failed', [item('b', 'failed', 'timed_out')]));
    const renderer = await mount(platform);

    await act(async () => byTestId(renderer, 'receive-item-entry-1-b')[0].props.onPress());
    await act(async () => byTestId(renderer, 'receive-retry-entry-1')[0].props.onPress());

    expect(textOf(renderer)).toContain(notice);
    expect(textOf(renderer)).not.toContain('receive.notice.retryAccepted');
  });

  it('shows the Engine failure message when retry is rejected', async () => {
    mockService.retry.mockRejectedValue(new Error('Engine failure invalidArgument'));
    publish(progress('failed', [item('b', 'failed', 'timed_out')]));
    const renderer = await mount(platform);

    await act(async () => byTestId(renderer, 'receive-item-entry-1-b')[0].props.onPress());
    await act(async () => byTestId(renderer, 'receive-retry-entry-1')[0].props.onPress());

    expect(textOf(renderer)).toContain('receive.notice.requestFailed');
  });

  it('rebuilds from the Engine each time the sheet opens', async () => {
    await mount(platform);
    expect(mockService.refresh).toHaveBeenCalledTimes(1);
  });

  it('flags a stale snapshot instead of hiding the last known state', async () => {
    publish(progress('failed', [item('b', 'failed', 'timed_out')]));
    useReceiveResultsStore.setState({ stale: true, error: 'runtime unavailable' });
    const renderer = await mount(platform);

    expect(textOf(renderer)).toContain('receive.stale');
    expect(byTestId(renderer, 'receive-item-entry-1-b')).toHaveLength(1);
  });

  it('shows an empty state when nothing is being received', async () => {
    const renderer = await mount(platform);
    expect(textOf(renderer)).toContain('receive.empty');
  });
});

describe('receive results UI ownership and reuse', () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

  it('follows the platform file convention without platform checks in shared files', () => {
    const base = read('src/components/ReceiveResultsSheet/ReceiveResultsSheet.tsx');
    expect(base).toContain("export * from './ReceiveResultsSheet.android'");
    const controller = read('src/components/ReceiveResultsSheet/useReceiveResultsController.ts');
    expect(controller).not.toContain('Platform.OS');
    expect(read('src/components/ReceiveResultsSheet/ReceiveResultsSheet.types.ts')).toContain(
      'ReceiveResultsSheetProps'
    );
  });

  it('reuses the shared bottom sheet and button on both platforms', () => {
    for (const platform of ['android', 'ios']) {
      const source = read(`src/components/ReceiveResultsSheet/ReceiveResultsSheet.${platform}.tsx`);
      expect(source).toContain("from '@/components/ui'");
      expect(source).toContain('AppBottomSheet');
      expect(source).toContain('AppButton');
      expect(source).toContain('useReceiveResultsController');
    }
  });

  it('is owned by the stable Home overlay host and not by Settings sub-pages', () => {
    const overlays = read('src/screens/HomeOverlays.tsx');
    expect(overlays).toContain('<ReceiveResultsSheet');
    expect(overlays).toContain('c.receiveResultsOpen');
    for (const file of [
      'src/screens/SettingsScreen.ios.tsx',
      'src/screens/SettingsScreen.android.tsx',
    ]) {
      expect(read(file)).not.toContain('ReceiveResultsSheet');
    }
  });

  it('is opened from the existing top-bar menus only while receive attempts exist', () => {
    const types = read('src/components/HomeTopBar.types.ts');
    expect(types).toContain('receiveResults');
    for (const platform of ['android', 'ios']) {
      const source = read(`src/components/HomeTopBar.${platform}.tsx`);
      expect(source).toContain('receiveResults');
      expect(source).toContain("'receive.menuEntry'");
    }
    const chrome = read('src/screens/HomeChrome.tsx');
    expect(chrome).toContain('receiveResults');
  });

  it('wires the service to the native Engine, its events and the app composition root', () => {
    const composition = read('src/app/runtime/composition.ts');
    expect(composition).toContain('configureReceiveResultsService(');
    expect(composition).toContain('getReceiveResultsService().start()');
    expect(composition).toContain('publishReceiveResultsSnapshot');
    // Android keeps the Engine running in the background, so no `running` event marks the return.
    expect(composition).toMatch(
      /AppState\.addEventListener\('change'[\s\S]{0,200}getReceiveResultsService\(\)\.refresh\(\)/
    );
  });
});
