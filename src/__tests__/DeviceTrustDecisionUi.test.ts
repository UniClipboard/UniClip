import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'src');

function read(relativePath: string): string {
  const path = join(root, relativePath);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

describe('global device trust decision UI', () => {
  it('uses the required platform file split and mounts above the application flows', () => {
    const entry = read('components/DeviceTrustDecision.tsx');
    const types = read('components/DeviceTrustDecision.types.ts');
    const app = read('../App.tsx');

    expect(entry).toContain("export * from './DeviceTrustDecision.android'");
    expect(types).toContain('export interface DeviceTrustDecisionProps');
    expect(app).toContain('<DeviceTrustDecision />');
    expect(app.lastIndexOf('<DeviceTrustDecision />')).toBeGreaterThan(
      app.lastIndexOf('processTextOverlay')
    );
  });

  it('prevents Android back and outside dismissal', () => {
    const android = read('components/DeviceTrustDecision.android.tsx');

    expect(android).toContain('dismissOnBackPress: false');
    expect(android).toContain('dismissOnClickOutside: false');
    expect(android).not.toContain('onDismissRequest={onClose}');
    expect(android).toContain('useActiveDeviceTrustDecisionSession');
    expect(android).toContain('<DeviceTrustDecisionContent decision={decision} />');
  });

  it('uses the reusable native iOS bottom sheet and disables every interactive dismiss path', () => {
    const ios = read('components/DeviceTrustDecision.ios.tsx');

    expect(ios).toContain('<BottomSheet');
    expect(ios).not.toContain('<Modal');
    expect(ios).toContain('if (!decision.view) return null;');
    expect(ios).toContain('interactiveDismissDisabled()');
    expect(ios).toContain("presentationDragIndicator('hidden')");
    expect(ios).toContain("presentationBackgroundInteraction('disabled')");
    expect(ios).toContain('const COMPACT_SHEET_FRACTION = 0.64');
    expect(ios).toContain('const EXPANDED_SHEET_FRACTION = 0.85');
    expect(ios).toContain('decisionNeedsExpandedSheet(view)');
    expect(ios).toContain('presentationDetents([{ fraction: sheetFraction }])');
    expect(ios).toContain('onIsPresentedChange={() => undefined}');
    expect(ios).toContain('style={styles.anchor}');
    expect(ios).toContain('zIndex: 100');
    expect(ios).not.toContain('onClose');
    expect(ios).not.toMatch(/PanResponder|onRequestClose|onTouchEnd/);
    expect(ios).not.toContain('useSafeAreaInsets');
    expect(ios).toContain('bottom: 28');
    expect(ios).toContain('useActiveDeviceTrustDecisionSession');
    expect(ios).toContain('<DeviceTrustDecisionContent decision={decision} />');
  });

  it('uses native iOS list rows with a trailing checkmark and full-row interaction', () => {
    const ios = read('components/DeviceTrustDecision.ios.tsx');
    const choiceRow = ios.slice(
      ios.indexOf('function ChoiceRow'),
      ios.indexOf('function SelectedImpactSection')
    );

    expect(ios).toContain('List,');
    expect(ios).toContain('Section,');
    expect(ios).toContain("listStyle('insetGrouped')");
    expect(choiceRow).toContain('<Spacer />');
    expect(choiceRow).toContain('systemName="checkmark"');
    expect(choiceRow).toContain('contentShape(shapes.rectangle())');
    expect(choiceRow).toContain("t('space.deviceTrust.continues'");
    expect(choiceRow).not.toContain('checkmark.circle.fill');
    expect(choiceRow).not.toContain('SELECTED_BACKGROUND');
    expect(choiceRow).not.toContain('requiresRejoinNames');
    expect(ios).not.toContain('space.deviceTrust.continuesSummary');
  });

  it('shows the selected impact separately and defers invitation details to confirmation', () => {
    const ios = read('components/DeviceTrustDecision.ios.tsx');

    expect(ios).toContain('function SelectedImpactSection');
    expect(ios).toContain('space.deviceTrust.changesTitle');
    expect(ios).toContain('space.deviceTrust.noStops');
    expect(ios).toContain('space.deviceTrust.reviewStopAction');
    expect(ios).toContain('function ConfirmationImpactSummary');

    for (const locale of ['en', 'pt-BR', 'ru', 'zh']) {
      const messages = JSON.parse(read(`i18n/locales/${locale}/settingsSync.json`));
      expect(messages.space.deviceTrust.changesTitle).toEqual(expect.any(String));
      expect(messages.space.deviceTrust.noStops).toEqual(expect.any(String));
      expect(messages.space.deviceTrust.reviewStopAction).toEqual(expect.any(String));
    }
  });

  it('reuses the standard large iOS app button for the fixed footer action', () => {
    const ios = read('components/DeviceTrustDecision.ios.tsx');
    const appButton = read('components/ui/AppButton.ios.tsx');
    const appButtonTypes = read('components/ui/AppButton.types.ts');

    expect(ios).toContain("import { AppButton, SheetHeader } from '@/components/ui'");
    expect(ios).toContain('<AppButton');
    expect(ios).toContain('fullWidth');
    expect(ios).toContain('size="large"');
    expect(appButtonTypes).toContain("size?: 'regular' | 'large'");
    expect(appButton).toContain("buttonBorderShape('capsule')");
    expect(appButton).toContain('controlSize(size)');
    expect(appButton).toContain('frame({ maxWidth: Infinity, minHeight: 50 })');
  });

  it('waits for the Settings sheet to dismiss before opening an iOS preview sheet', () => {
    const settings = read('screens/SettingsScreen.ios.tsx');

    expect(settings).toContain('pendingDeviceTrustPreview.current = scenarioId');
    expect(settings).toContain('const pendingPreview = pendingDeviceTrustPreview.current');
    expect(settings).toContain('openDeviceTrustPreview(pendingPreview)');
    expect(settings.indexOf('openDeviceTrustPreview(pendingPreview)')).toBeLessThan(
      settings.indexOf('navigation.goBack()')
    );
  });

  it('keeps preview exit in the iOS header and out of the decision footer', () => {
    const ios = read('components/DeviceTrustDecision.ios.tsx');

    expect(ios).toContain('<SheetHeader');
    expect(ios).toContain('systemName="xmark"');
    expect(ios).toContain('right={decision.dismiss ?');
    expect(ios).not.toContain("<SwiftUIText>{t('action.close', { ns: 'common' })}</SwiftUIText>");
  });

  it('explains both stale decision outcomes on each platform', () => {
    const android = read('components/DeviceTrustDecision.android.tsx');
    const ios = read('components/DeviceTrustDecision.ios.tsx');

    for (const platform of [android, ios]) {
      expect(platform).toContain("decision.outcome === 'stateChanged'");
      expect(platform).toContain("decision.outcome === 'alreadyCompleted'");
      expect(platform).toContain("t('space.deviceTrust.stateChanged')");
    }
  });

  it('explains which devices need a new invitation after each choice', () => {
    const android = read('components/DeviceTrustDecision.android.tsx');
    const ios = read('components/DeviceTrustDecision.ios.tsx');

    for (const platform of [android, ios]) {
      expect(platform).toContain('choice.requiresRejoinNames');
      expect(platform).toContain('space.deviceTrust.requiresRejoin');
    }
    for (const locale of ['en', 'pt-BR', 'ru', 'zh']) {
      const messages = JSON.parse(read(`i18n/locales/${locale}/settingsSync.json`));
      expect(messages.space.deviceTrust.requiresRejoin).toEqual(expect.any(String));
    }
  });

  it('uses concise iOS decision copy and an explicit action for every locale', () => {
    const ios = read('components/DeviceTrustDecision.ios.tsx');

    for (const key of [
      'sheetTitle',
      'sheetBody',
      'chooseAction',
      'applyAction',
      'keepAction',
      'reviewStopAction',
      'reviewLeaveAction',
    ]) {
      expect(ios).toContain(`space.deviceTrust.${key}`);
      for (const locale of ['en', 'pt-BR', 'ru', 'zh']) {
        const messages = JSON.parse(read(`i18n/locales/${locale}/settingsSync.json`));
        expect(messages.space.deviceTrust[key]).toEqual(expect.any(String));
      }
    }
  });

  it('separates option selection from the explicit continue action', () => {
    const android = read('components/DeviceTrustDecision.android.tsx');
    const ios = read('components/DeviceTrustDecision.ios.tsx');

    expect(android).toContain('RadioButton');
    expect(android).toContain('selectableGroup()');
    expect(android).toContain('decision.choose(choice.choice)');
    expect(android).toContain('decision.proceed()');
    expect(ios).toContain('checkmark.circle.fill');
    expect(ios).toContain('decision.choose(choice.choice)');
    expect(ios).toContain('decision.proceed()');
  });

  it('keeps platform branching out of the shared component contract', () => {
    const entry = read('components/DeviceTrustDecision.tsx');
    const types = read('components/DeviceTrustDecision.types.ts');

    expect(`${entry}\n${types}`).not.toContain('Platform.OS');
  });

  it('keeps preview data isolated from space state, services, runtime, and Engine', () => {
    const preview = read('devtools/deviceTrustPreviewSession.ts');

    expect(preview).not.toMatch(/features\/space|UnifiedSpace|spaceService|app\/runtime/);
    expect(preview).not.toMatch(/platform\/engine|uc-engine/);
  });

  it('keeps one global host and gives authoritative work priority over previews', () => {
    const app = read('../App.tsx');
    const coordinator = read('components/useActiveDeviceTrustDecisionSession.ts');

    expect(app.match(/<DeviceTrustDecision \/>/g)).toHaveLength(1);
    expect(coordinator).toContain('hasAuthoritativeDeviceTrustWork');
    expect(coordinator).toContain('deviceTrustPreviewSession.close()');
    expect(coordinator).toContain(
      'return authoritative ? liveSession : previewSession ?? liveSession;'
    );
  });
});
