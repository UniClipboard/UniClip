import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('Android priority UX regressions', () => {
  it('builds every Settings secondary title from the owning translation namespace', () => {
    const navigator = read('src/navigation/AppNavigator.tsx');

    expect(navigator).toContain("syncChannel: t('syncChannel.title', { ns: 'settings' })");
    expect(navigator).toContain("history: t('category.history', { ns: 'settings' })");
    expect(navigator).toContain("background: t('category.background', { ns: 'settings' })");
    expect(navigator).toContain("appearance: t('appearance.sectionTitle', { ns: 'settings' })");
    expect(navigator).toContain("storage: t('category.storage', { ns: 'settings' })");
    expect(navigator).toContain("about: t('category.about', { ns: 'settings' })");
    expect(navigator).toContain("developer: t('category.developer', { ns: 'settings' })");
    expect(navigator).not.toContain("t('nav.");
  });

  it('selects clipboard-direction descriptions for the active sync method', () => {
    const settings = read('src/screens/SettingsScreen.android.tsx');

    expect(settings).toContain('const syncChannel = useSettingsStore');
    expect(settings).toContain("syncChannel === 'p2p'");
    expect(settings).toContain('hub.clipboardSync.autoApply.descP2p');
    expect(settings).toContain('hub.clipboardSync.autoApply.descLan');
    expect(settings).toContain('hub.clipboardSync.autoPush.descP2p');
    expect(settings).toContain('hub.clipboardSync.autoPush.descLan');
  });

  it.each(['zh', 'en', 'ru', 'pt-BR'])(
    'provides channel-aware clipboard descriptions in %s',
    (locale) => {
      const messages = JSON.parse(read(`src/i18n/locales/${locale}/settings.json`)) as {
        hub?: {
          clipboardSync?: {
            autoApply?: Record<string, string>;
            autoPush?: Record<string, string>;
          };
        };
      };

      expect(messages.hub?.clipboardSync?.autoApply).toEqual(
        expect.objectContaining({ descLan: expect.any(String), descP2p: expect.any(String) })
      );
      expect(messages.hub?.clipboardSync?.autoPush).toEqual(
        expect.objectContaining({ descLan: expect.any(String), descP2p: expect.any(String) })
      );
    }
  );

  it('guards both single and batch history deletion with the Android confirmation policy', () => {
    const controller = read('src/screens/useHomeController.ts');
    const policy = read('src/utils/confirmHistoryDelete.android.ts');

    expect(controller).toContain(
      "import { confirmHistoryDelete } from '@/utils/confirmHistoryDelete'"
    );
    expect(controller.match(/await confirmHistoryDelete\(/g)).toHaveLength(2);
    expect(policy).toContain('Alert.alert');
    expect(policy).toContain("style: 'destructive'");
  });

  it('names Android Home icon actions and exposes card selection state', () => {
    const topBar = read('src/components/HomeTopBar.android.tsx');
    const bottomBar = read('src/components/HomeBottomBar.android.tsx');
    const card = read('src/components/ClipboardCard.android.tsx');
    const menu = read('src/components/android/TopRightMenu.tsx');

    expect(topBar).toContain("accessibilityLabel={t('a11y.search')}");
    expect(topBar).toContain("accessibilityLabel={t('a11y.clearSearch')}");
    expect(topBar).toContain("accessibilityLabel={t('a11y.searchFilters')}");
    expect(topBar).toContain("accessibilityLabel={t('action.close', { ns: 'common' })}");
    expect(bottomBar).toContain("accessibilityLabel={t('action.copy')}");
    expect(bottomBar).toContain("accessibilityLabel={t('action.share')}");
    expect(bottomBar).toContain("accessibilityLabel={t('action.delete')}");
    expect(card).toContain('accessibilityRole="button"');
    expect(card).toContain(
      'accessibilityState={{ selected: isSelectMode ? isSelected : undefined }}'
    );
    expect(menu).toContain("accessibilityLabel={t('action.more')}");
    expect(menu).not.toContain('TouchableOpacity');
  });

  it('reserves enough list space for the Android selection action bar', () => {
    const compact = read('src/screens/HomeCompactView.tsx');

    expect(compact).toContain('const selectionBarClearance = c.insets.bottom + 76;');
    expect(compact).toContain('paddingBottom={isSelectMode ? selectionBarClearance : 80}');
    expect(compact).toContain('backgroundColor: theme.colors.surfaceLow');
  });

  it('offers an in-place refresh when the Share page has no available targets', () => {
    const sheet = read('src/components/ShareSendSheet/ShareSendSheet.android.tsx');
    const controller = read('src/components/ShareSendSheet/useShareSendController.ts');

    expect(sheet).toContain('onRefresh={c.refreshTargets}');
    expect(sheet).toContain("accessibilityLabel={t('action.refresh', { ns: 'common' })}");
    expect(controller).toContain('const refreshTargets = useCallback');
    expect(controller).toContain('refreshTargets,');
  });

  it('uses one full-row Android switch component across visible Settings pages', () => {
    const row = read('src/screens/settings/android/SettingsSwitchRow.tsx');
    const rootSettings = read('src/screens/SettingsScreen.android.tsx');
    const appearance = read('src/screens/settings/android/AppearanceSection.tsx');
    const history = read('src/screens/settings/HistorySection.tsx');

    expect(row).toContain("toggleable(value, toggle, { role: 'switch' })");
    expect(row).toContain('onCheckedChange={toggle}');
    expect(rootSettings.match(/<SettingsSwitchRow/g)).toHaveLength(2);
    expect(appearance).toContain('<SettingsSwitchRow');
    expect(history).toContain('<SettingsSwitchRow');
  });

  it('presents fixed-choice Android settings as selectors instead of text inputs', () => {
    const dropdown = read('src/components/ui/AppDropdown.android.tsx');
    const history = read('src/screens/settings/HistorySection.tsx');

    expect(dropdown).toContain('OutlinedButton');
    expect(dropdown).toContain('onClick={undefined}');
    expect(dropdown).toContain('ICONS.expandMore');
    expect(dropdown).not.toContain('OutlinedTextField');
    expect(history).toContain('<AppDropdown');
    expect(history).not.toContain('<ExposedDropdownMenuBox');
  });

  it('keeps server completion actions visible and protects dirty editor dismissal', () => {
    const sheet = read('src/components/LanServerEditorSheet.android.tsx');
    const editor = read('src/features/lan-servers/useLanServerEditor.ts');
    const textField = read('src/components/ui/AppTextField.android.tsx');

    expect(sheet).toContain('const requestClose = () =>');
    expect(sheet).toContain('editor.isDirty');
    expect(sheet).toContain('<EditorFooter');
    expect(sheet).toContain('modifiers={[weight(1), verticalScroll()]}');
    expect(sheet).toContain('<OutlinedButton onClick={editor.openScanner}');
    expect(sheet).toContain("secureToggleLabel={t('lan.passwordShow')}");
    expect(sheet).toContain("t('lan.discardTitle')");
    expect(editor).toContain('isDirty,');
    expect(textField).toContain('OutlinedTextField.TrailingIcon');
    expect(textField).toContain('secureVisible');
  });

  it.each(['zh', 'en', 'ru', 'pt-BR'])(
    'provides server discard and password visibility labels in %s',
    (locale) => {
      const messages = JSON.parse(read(`src/i18n/locales/${locale}/settingsSync.json`)) as {
        lan?: Record<string, string>;
      };

      expect(messages.lan).toEqual(
        expect.objectContaining({
          discardTitle: expect.any(String),
          discardMessage: expect.any(String),
          discardAction: expect.any(String),
          passwordShow: expect.any(String),
          passwordHide: expect.any(String),
        })
      );
    }
  );
});
