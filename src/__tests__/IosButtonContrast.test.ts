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

  it('keeps copy and share actions equal width with single-line labels', () => {
    const sheet = source('components/AddSyncConnectionSheet.ios.tsx');
    const actions = sheet.slice(
      sheet.indexOf('onPress={copyInvitation}'),
      sheet.indexOf('finishLater')
    );
    const label = sheet.slice(
      sheet.indexOf('function InvitationActionLabel'),
      sheet.indexOf('function ConnectionChoice')
    );

    expect(actions).toContain('iosSecondaryButtonModifiers()');
    expect(actions).toContain('iosProminentButtonModifiers(');
    expect(actions.match(/<InvitationActionLabel/g)).toHaveLength(2);
    expect(label).toContain('frame({ maxWidth: Infinity })');
    expect(label).toContain('lineLimit(1)');
    expect(label).toContain('minimumScaleFactor(0.72)');
  });

  it('uses the same contrast rule in the shared iOS AppButton', () => {
    const appButton = source('components/ui/AppButton.ios.tsx');

    expect(appButton).toContain('iosProminentButtonModifiers');
    expect(appButton).not.toContain("filled: 'borderedProminent'");
  });
});
