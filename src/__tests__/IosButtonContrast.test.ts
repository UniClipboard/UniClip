import fs from 'fs';
import path from 'path';

const sourceRoot = path.resolve(__dirname, '..');

function source(relativePath: string): string {
  return fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8');
}

function iosSourceFiles(relativeDirectory: string): string[] {
  const directory = path.join(sourceRoot, relativeDirectory);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) return iosSourceFiles(relativePath);
    return entry.name.endsWith('.ios.tsx') ? [relativePath] : [];
  });
}

describe('iOS button contrast and sizing', () => {
  it('defines prominent buttons as paired background and foreground colors', () => {
    const buttonStyles = source('components/ui/iosButtonStyles.ios.ts');
    const tokens = source('theme/iosDesignTokens.ts');

    expect(tokens).toContain('iosOnAccentColor');
    expect(tokens).toContain('iosOnSaturatedColor');
    expect(buttonStyles).toContain('iosProminentButtonModifiers');
    expect(buttonStyles).toContain('tint(palette.background)');
    expect(buttonStyles).toContain('foregroundStyle(palette.foreground)');
    expect(buttonStyles).toContain('iosAccentButtonPalette');
    expect(buttonStyles).toContain('iosSaturatedButtonPalette');
  });

  it('routes every prominent iOS button through the contrast-safe helper', () => {
    const directProminentButtons = iosSourceFiles('components')
      .concat(iosSourceFiles('screens'))
      .filter((relativePath) => source(relativePath).includes("buttonStyle('borderedProminent')"));

    expect(directProminentButtons).toEqual([]);
  });

  it('keeps the share action full width with a single-line label', () => {
    const sheet = source('components/AddSyncConnectionSheet.ios.tsx');
    const actions = sheet.slice(
      sheet.indexOf("{mode === 'invitation' && invitation ? ("),
      sheet.indexOf('testID="space-finish-later"')
    );
    const button = sheet.slice(
      sheet.indexOf('function SheetActionButton'),
      sheet.indexOf('type PairingSymbolMotion')
    );

    expect(actions).toContain("t('space.flow.shareInvitation')");
    // Copy moved onto the tappable invitation code card.
    expect(actions).not.toContain("t('space.flow.copyInvitation')");
    expect(button).toContain('iosSecondaryButtonModifiers({ fullWidth: true })');
    expect(button).toContain('iosProminentButtonModifiers(');
    expect(button).toContain('frame({ minHeight: 48, maxWidth: Infinity })');
    expect(button).toContain('lineLimit(1)');
    expect(button).toContain('minimumScaleFactor(0.72)');
  });

  it('makes the finish-later settings row tappable across its full width', () => {
    const sheet = source('components/AddSyncConnectionSheet.ios.tsx');
    const finishLater = sheet.slice(
      sheet.indexOf('testID="space-finish-later"'),
      sheet.indexOf("{mode === 'success'")
    );
    const tertiary = sheet.slice(
      sheet.indexOf("if (variant === 'tertiary')"),
      sheet.indexOf('const styleModifiers')
    );

    expect(finishLater).toContain('variant="tertiary"');
    expect(tertiary).toContain('frame({ maxWidth: Infinity');
    expect(tertiary).toContain('contentShape(shapes.rectangle())');
  });

  it('uses the same contrast rule in the shared iOS AppButton', () => {
    const appButton = source('components/ui/AppButton.ios.tsx');

    expect(appButton).toContain('iosProminentButtonModifiers');
    expect(appButton).not.toContain("filled: 'borderedProminent'");
  });
});
