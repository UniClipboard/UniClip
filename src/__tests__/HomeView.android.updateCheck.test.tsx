import TestRenderer, { act } from 'react-test-renderer';
import { useMessageStore } from '../stores/messageStore';
import type { UpdateCheckResult } from '../features/updates';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const updateResult: UpdateCheckResult = {
  hasUpdate: true,
  latestVersion: '1.4.0',
  tagName: 'v1.4.0',
  releaseUrl: 'https://example.com/release',
  assets: [],
};

const mockCheckForAutomaticUpdate = jest.fn<Promise<UpdateCheckResult | null>, unknown[]>(
  async () => updateResult
);

jest.mock('@/features/updates', () => ({
  checkForAutomaticUpdate: (currentVersion: string, settings: unknown) =>
    mockCheckForAutomaticUpdate(currentVersion, settings),
}));

jest.mock('@/stores', () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({
      config: {
        autoCheckUpdate: true,
        updateToBeta: false,
        debugUpdateCheckNoLimit: false,
      },
    }),
}));

jest.mock('@/constants', () => ({ APP_VERSION: '1.3.0' }));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { version?: string }) =>
      options?.version ? `${key}:${options.version}` : key,
    i18n: { resolvedLanguage: 'zh-CN', language: 'zh-CN' },
  }),
}));

jest.mock('@/hooks/useLayoutMode', () => ({ getLayoutMode: () => 'compact' }));
jest.mock('@/screens/useHomeController', () => ({
  useHomeController: () => ({
    theme: { colors: { accent: '#000' } },
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  }),
}));
jest.mock('@/screens/HomeCompactView', () => ({ HomeCompactView: () => null }));
jest.mock('@/screens/HomeExpandedView', () => ({ HomeExpandedView: () => null }));

import { HomeView } from '../screens/HomeView.android';

async function flushEffects() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

describe('Android Home update check', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useMessageStore.setState({ message: null });
    mockCheckForAutomaticUpdate.mockResolvedValue(updateResult);
  });

  it('announces an update with a non-blocking snackbar whose action opens the update flow', async () => {
    const onOpenAbout = jest.fn();

    act(() => {
      TestRenderer.create(<HomeView onOpenSettings={jest.fn()} onOpenAbout={onOpenAbout} />);
    });
    await flushEffects();

    expect(mockCheckForAutomaticUpdate).toHaveBeenCalledWith('1.3.0', {
      autoCheckUpdate: true,
      updateToBeta: false,
      debugUpdateCheckNoLimit: false,
      language: 'zh-CN',
    });
    const message = useMessageStore.getState().message;
    expect(message?.text).toContain('1.4.0');
    expect(message?.action?.label).toBe('update.updateTo:1.4.0');
    message?.action?.onPress();
    expect(onOpenAbout).toHaveBeenCalledWith(updateResult);
  });

  it('stays silent when no new version is available', async () => {
    mockCheckForAutomaticUpdate.mockResolvedValue(null);

    act(() => {
      TestRenderer.create(<HomeView onOpenSettings={jest.fn()} onOpenAbout={jest.fn()} />);
    });
    await flushEffects();

    expect(useMessageStore.getState().message).toBeNull();
  });
});
