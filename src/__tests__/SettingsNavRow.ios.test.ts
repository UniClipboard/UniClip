import fs from 'fs';
import path from 'path';

const settingsCommon = fs.readFileSync(
  path.resolve(__dirname, '../screens/settings/ios/common.tsx'),
  'utf8'
);

describe('iOS settings navigation rows', () => {
  it('use a native button so every navigation row provides press feedback', () => {
    const row = settingsCommon.match(/export function SettingsNavRow[\s\S]*?\n}\n\n\/\*\*/)?.[0];

    expect(row).toContain('<SwiftUIButton');
    expect(row).not.toContain('onTapGesture(onPress)');
  });

  it('keeps the press state visible before opening the next page', () => {
    const row = settingsCommon.match(/export function SettingsNavRow[\s\S]*?\n}\n\n\/\*\*/)?.[0];

    expect(settingsCommon).toContain('const settingsNavigationDelayMs = 120;');
    expect(settingsCommon).toContain(
      'const settingsRowPressedColor = iosColors?.tertiarySystemFill'
    );
    expect(row).toContain('const [isPressed, setIsPressed] = useState(false);');
    expect(row).toContain('setIsPressed(true);');
    expect(row).toContain('listRowBackground(settingsRowPressedColor)');
    expect(row).not.toContain("background(isPressed ? settingsRowPressedColor : 'clear')");
    expect(row).toContain('setTimeout(() => {');
    expect(row).toContain('onPress();');
    expect(row).not.toContain('minHeight');
  });

  it('supports immediate and destructive settings actions without a separate row implementation', () => {
    const row = settingsCommon.match(/export function SettingsNavRow[\s\S]*?\n}\n\n\/\*\*/)?.[0];

    expect(settingsCommon).toContain('destructive?: boolean;');
    expect(settingsCommon).toContain('disabled?: boolean;');
    expect(settingsCommon).toContain('showsChevron?: boolean;');
    expect(settingsCommon).toContain('showsPressFeedback?: boolean;');
    expect(row).toContain('if (!showsPressFeedback) {');
    expect(row).toContain("role={destructive ? 'destructive' : undefined}");
    expect(row).toContain('disabledModifier(disabled)');
    expect(row).toContain('{showsChevron ? <Image');
  });

  it('makes the full row label tappable, including empty trailing space', () => {
    const row = settingsCommon.match(/export function SettingsNavRow[\s\S]*?\n}\n\n\/\*\*/)?.[0];

    expect(row).toMatch(
      /<HStack spacing=\{12\} modifiers=\{\[frame\(\{ maxWidth: Infinity \}\), contentShape\(shapes\.rectangle\(\)\)\]\}/
    );
  });

  it('can represent a text-only action row without duplicating the row behavior', () => {
    const row = settingsCommon.match(/export function SettingsNavRow[\s\S]*?\n}\n\n\/\*\*/)?.[0];

    expect(settingsCommon).toContain('icon?: SFSymbol;');
    expect(settingsCommon).toContain('iconColor?: string;');
    expect(row).toContain('icon && iconColor ? (');
  });

  it('uses plain action icons while preserving colored category tiles and their alignment', () => {
    expect(settingsCommon).toContain('<SettingsIconTile systemName={icon} color={iconColor} />');
    expect(settingsCommon).toContain(') : icon ? (');
    expect(settingsCommon).toContain(
      "color={destructive ? PlatformColor('systemRed') : iosAccentColor}"
    );
    expect(settingsCommon).toContain('modifiers={[frame({ width: 28, height: 28 })]}');
  });

  it('can show a native checkmark for a selected setting row', () => {
    const row = settingsCommon.match(/export function SettingsNavRow[\s\S]*?\n}\n\n\/\*\*/)?.[0];

    expect(settingsCommon).toContain('selected?: boolean;');
    expect(row).toContain('selected ? <Image systemName="checkmark"');
  });

  it('can show a compact badge without duplicating the settings row', () => {
    const row = settingsCommon.match(/export function SettingsNavRow[\s\S]*?\n}\n\n\/\*\*/)?.[0];

    expect(settingsCommon).toContain('badge?: string;');
    expect(row).toContain('{badge ? (');
    expect(row).toMatch(/<SwiftUIText[\s\S]*?\{badge\}[\s\S]*?<\/SwiftUIText>/);
    expect(row!.indexOf('{badge ? (')).toBeLessThan(row!.indexOf('<Spacer />'));
  });
});
