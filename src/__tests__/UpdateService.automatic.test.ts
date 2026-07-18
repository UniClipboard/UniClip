import * as updateService from '../services/UpdateService';
import type { UpdateCheckResult } from '../services/UpdateService';

const availableUpdate: UpdateCheckResult = {
  hasUpdate: true,
  latestVersion: '1.4.0',
  tagName: 'v1.4.0',
  releaseUrl: 'https://example.com/release',
  giteeReleaseUrl: 'https://example.com/gitee-release',
  assets: [],
};

type AutomaticUpdateCheck = (
  currentVersion: string,
  settings: {
    autoCheckUpdate: boolean;
    updateToBeta: boolean;
    debugUpdateCheckNoLimit: boolean;
    language: string;
  },
  dependencies: {
    getToday: () => string;
    loadLastCheckDate: () => Promise<string>;
    recordCheckDate: (date: string) => Promise<void>;
    check: (
      currentVersion: string,
      includeBeta: boolean,
      language: string
    ) => Promise<UpdateCheckResult>;
  }
) => Promise<UpdateCheckResult | null>;

const checkForAutomaticUpdate = (
  updateService as typeof updateService & { checkForAutomaticUpdate?: AutomaticUpdateCheck }
).checkForAutomaticUpdate;

function createDependencies(lastCheckDate = '') {
  return {
    getToday: jest.fn(() => '2026-07-18'),
    loadLastCheckDate: jest.fn(async () => lastCheckDate),
    recordCheckDate: jest.fn(async () => {}),
    check: jest.fn(async () => availableUpdate),
  };
}

describe('automatic update checks', () => {
  it('checks from an eligible screen and records the day', async () => {
    expect(checkForAutomaticUpdate).toBeDefined();
    if (!checkForAutomaticUpdate) return;

    const dependencies = createDependencies();
    const result = await checkForAutomaticUpdate(
      '1.3.0',
      {
        autoCheckUpdate: true,
        updateToBeta: true,
        debugUpdateCheckNoLimit: false,
        language: 'zh-CN',
      },
      dependencies
    );

    expect(dependencies.recordCheckDate).toHaveBeenCalledWith('2026-07-18');
    expect(dependencies.check).toHaveBeenCalledWith('1.3.0', true, 'zh-CN');
    expect(result).toEqual(availableUpdate);
  });

  it('does not repeat an automatic check on the same day', async () => {
    expect(checkForAutomaticUpdate).toBeDefined();
    if (!checkForAutomaticUpdate) return;

    const dependencies = createDependencies('2026-07-18');
    const result = await checkForAutomaticUpdate(
      '1.3.0',
      {
        autoCheckUpdate: true,
        updateToBeta: false,
        debugUpdateCheckNoLimit: false,
        language: 'en',
      },
      dependencies
    );

    expect(result).toBeNull();
    expect(dependencies.recordCheckDate).not.toHaveBeenCalled();
    expect(dependencies.check).not.toHaveBeenCalled();
  });

  it('does not check when automatic updates are disabled', async () => {
    expect(checkForAutomaticUpdate).toBeDefined();
    if (!checkForAutomaticUpdate) return;

    const dependencies = createDependencies();
    const result = await checkForAutomaticUpdate(
      '1.3.0',
      {
        autoCheckUpdate: false,
        updateToBeta: false,
        debugUpdateCheckNoLimit: false,
        language: 'en',
      },
      dependencies
    );

    expect(result).toBeNull();
    expect(dependencies.loadLastCheckDate).not.toHaveBeenCalled();
    expect(dependencies.check).not.toHaveBeenCalled();
  });
});
