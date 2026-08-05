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
});
