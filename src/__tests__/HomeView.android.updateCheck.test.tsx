import TestRenderer, { act } from 'react-test-renderer';
import { Alert } from 'react-native';
import type { UpdateCheckResult } from '../services/UpdateService';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const updateResult: UpdateCheckResult = {
  hasUpdate: true,
  latestVersion: '1.4.0',
  tagName: 'v1.4.0',
  releaseUrl: 'https://example.com/release',
  giteeReleaseUrl: 'https://example.com/gitee-release',
  assets: [],
};

const mockCheckForAutomaticUpdate = jest.fn<Promise<UpdateCheckResult | null>, unknown[]>(
  async () => updateResult
);

jest.mock('@/services', () => ({
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
  useHomeController: () => ({ theme: { colors: { accent: '#000' } } }),
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
    mockCheckForAutomaticUpdate.mockResolvedValue(updateResult);
  });

  it('checks on Home and opens the existing update flow when accepted', async () => {
    const onOpenAbout = jest.fn();
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

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
    expect(alertSpy).toHaveBeenCalledTimes(1);

    const buttons = alertSpy.mock.calls[0][2];
    const updateButton = buttons?.find((button) => button.style !== 'cancel');
    updateButton?.onPress?.();
    expect(onOpenAbout).toHaveBeenCalledWith(updateResult);
  });

  it('stays silent when no new version is available', async () => {
    mockCheckForAutomaticUpdate.mockResolvedValue(null);
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    act(() => {
      TestRenderer.create(<HomeView onOpenSettings={jest.fn()} onOpenAbout={jest.fn()} />);
    });
    await flushEffects();

    expect(alertSpy).not.toHaveBeenCalled();
  });
});
