import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');

function source(relativePath: string): string {
  const absolutePath = path.join(root, relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : '';
}

describe('P2P onboarding and upgrade UI', () => {
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
      en: 'Join a space with an invitation to continue syncing. Your local history stays available.',
      'pt-BR':
        'Entre em um espaço com um convite para continuar sincronizando. Seu histórico local continuará disponível.',
      ru: 'Присоединитесь к пространству по приглашению, чтобы продолжить синхронизацию. Локальная история останется доступна.',
      zh: '使用邀请码加入空间即可继续同步。本地历史会继续保留。',
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
    const flow = source('components/useAddSyncConnectionFlow.ts');

    expect(types).toContain('initialMode');
    for (const platform of [android, ios]) {
      expect(platform).toContain('initialMode');
      expect(platform).toContain('useAddSyncConnectionFlow');
    }
    expect(flow).toContain('setMode(modeFromInitial(initialMode))');
  });

  it('sends upgraded users without a space directly into Join Space', () => {
    const overlays = source('screens/HomeOverlays.tsx');

    expect(overlays).toContain('initialMode="join"');
    expect(overlays).not.toContain('LanMigrationPrompt');
    expect(overlays).not.toContain('legacyLan');
  });
});
