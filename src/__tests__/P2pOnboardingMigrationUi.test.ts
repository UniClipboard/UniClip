import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');

function source(relativePath: string): string {
  const absolutePath = path.join(root, relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : '';
}

describe('P2P onboarding and LAN migration UI', () => {
  it('offers create, join, and skip without a legacy LAN scanner on both platforms', () => {
    const types = source('screens/OnboardingScreen.types.ts');
    const android = source('screens/OnboardingScreen.android.tsx');
    const ios = source('screens/OnboardingScreen.ios.tsx');

    expect(types).toContain("'create'");
    expect(types).toContain("'join'");
    for (const platform of [android, ios]) {
      expect(platform).toContain('AddSyncConnectionSheet');
      expect(platform).toContain("setFlow('create')");
      expect(platform).toContain("setFlow('join')");
      expect(platform).toContain('onComplete');
      expect(platform).not.toContain('QrScannerModal');
      expect(platform).not.toContain('LanArt');
    }
  });

  it('keeps the skipped-setup empty state P2P-first in every locale', () => {
    const expectedDescriptions = {
      en: 'Create a space or join one with an invitation to start syncing. Your local history stays available.',
      'pt-BR':
        'Crie um espaço ou entre com um convite para começar a sincronizar. Seu histórico local continuará disponível.',
      ru: 'Создайте пространство или присоединитесь по приглашению, чтобы начать синхронизацию. Локальная история останется доступна.',
      zh: '创建空间或使用邀请码加入即可开始同步。本地历史会继续保留。',
    };

    for (const [locale, description] of Object.entries(expectedDescriptions)) {
      const home = JSON.parse(source(`i18n/locales/${locale}/home.json`));
      expect(home.empty.unconfigured.description).toBe(description);
    }
  });

  it('lets the unified add sheet start directly in create or join mode', () => {
    const types = source('components/AddSyncConnectionSheet.types.ts');
    const android = source('components/AddSyncConnectionSheet.android.tsx');
    const ios = source('components/AddSyncConnectionSheet.ios.tsx');

    expect(types).toContain('initialMode');
    for (const platform of [android, ios]) {
      expect(platform).toContain('initialMode');
      expect(platform).toContain('setMode(modeFromInitial(initialMode))');
    }
  });

  it('mounts a version-scoped native migration prompt through the Home add flow', () => {
    const types = source('components/LanMigrationPrompt.types.ts');
    const android = source('components/LanMigrationPrompt.android.tsx');
    const ios = source('components/LanMigrationPrompt.ios.tsx');
    const controller = source('screens/useHomeController.ts');
    const overlays = source('screens/HomeOverlays.tsx');

    expect(types).toContain('onSetUpP2p');
    expect(types).toContain('onRemindLater');
    expect(android).toContain('AlertDialog');
    expect(ios).toContain('<Alert');
    expect(controller).toContain('shouldShowLanMigrationPrompt');
    expect(controller).toContain('lanMigrationPromptedVersion: APP_VERSION');
    expect(overlays).toContain('LanMigrationPrompt');
    expect(overlays).toContain('setShowAddConnection(true)');
  });

  it('rejects ineligible legacy connect links before saving pending credentials', () => {
    const app = fs.readFileSync(path.resolve(process.cwd(), 'App.tsx'), 'utf8');
    const eligibilityCheck = app.indexOf('legacyLanEligible');
    const pendingWrite = app.indexOf('usePendingConnectStore.getState().set');

    expect(eligibilityCheck).toBeGreaterThan(-1);
    expect(pendingWrite).toBeGreaterThan(eligibilityCheck);
  });
});
