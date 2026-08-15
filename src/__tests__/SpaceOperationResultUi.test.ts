import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(path: string): string {
  return readFileSync(join(process.cwd(), 'src', path), 'utf8');
}

describe('space operation result UI', () => {
  it('uses platform-specific non-dismissible result implementations', () => {
    const entry = source('components/SpaceOperationResult.tsx');
    const types = source('components/SpaceOperationResult.types.ts');
    const android = source('components/SpaceOperationResult.android.tsx');
    const ios = source('components/SpaceOperationResult.ios.tsx');

    expect(entry).toContain("export * from './SpaceOperationResult.android'");
    expect(types).toContain('export interface SpaceOperationResultProps');
    expect(android).toContain('dismissOnBackPress: false');
    expect(android).toContain('dismissOnClickOutside: false');
    expect(ios).toContain('presentationStyle="fullScreen"');
    expect(ios).toContain('onRequestClose={() => undefined}');
    for (const platform of [android, ios]) {
      expect(platform).toContain('space.operation.localStatus.');
      expect(platform).toContain('result.localDeviceInSpace');
      expect(platform).toContain("result.decisionOutcome === 'stateChanged'");
      expect(platform).toContain("result.decisionOutcome === 'alreadyCompleted'");
    }
  });

  it('is mounted globally and clears only from the explicit completion action', () => {
    const app = readFileSync(join(process.cwd(), 'App.tsx'), 'utf8');
    const hook = source('components/useSpaceOperationResult.ts');

    expect(app).toContain('<SpaceOperationResult />');
    expect(hook).toContain('state.operationState');
    expect(hook).toContain('clearOperationResult()');
  });

  it('has complete result copy in every supported language', () => {
    for (const locale of ['en', 'pt-BR', 'ru', 'zh']) {
      const messages = JSON.parse(source(`i18n/locales/${locale}/settingsSync.json`));
      for (const kind of ['removeMember', 'applyChange', 'keepCurrentSpace', 'leaveSpace']) {
        expect(messages.space.operation.title[kind]).toEqual(expect.any(String));
      }
      for (const key of [
        'none',
        'verified',
        'unverified',
        'usable',
        'separated',
        'continuing',
        'offlinePending',
        'done',
      ]) {
        expect(messages.space.operation[key]).toEqual(expect.any(String));
      }
      expect(messages.space.operation.localStatus.inSpace).toEqual(expect.any(String));
      expect(messages.space.operation.localStatus.leftSpace).toEqual(expect.any(String));
      expect(messages.space.operation.outcome.stateChanged).toEqual(expect.any(String));
      expect(messages.space.operation.outcome.alreadyCompleted).toEqual(expect.any(String));
    }
  });
});
