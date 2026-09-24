import fs from "node:fs";
import path from "node:path";
const read = (file: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
describe("native test identifiers preserve shared full-row controls", () => {
  it("forwards identifiers through the existing shared iOS button and settings row", () => {
    expect(read("components/ui/AppButton.ios.tsx")).toContain(
      "testID={testID}"
    );
    expect(read("screens/settings/ios/common.tsx")).toContain(
      "testID={testID}"
    );
    expect(read("screens/settings/ios/SettingsRootPage.tsx")).toMatch(
      /<SettingsNavRow\s+testID="settings-storage"/
    );
  });
  it("identifies the entire clickable Android settings row", () => {
    expect(read("screens/SettingsScreen.android.tsx")).toContain(
      "testID={`settings-${section}`}"
    );
    expect(read("screens/SettingsScreen.android.tsx")).toContain(
      "onPress={() => onNavigate(section)}"
    );
    // testID 与点击都挂在同一个整行 ListItem 上
    expect(read("screens/settings/android/SettingsListRow.tsx")).toMatch(
      /testIDModifier\(testID\)[\s\S]*?clickable\(onPress\)[\s\S]*?<ListItem colors=\{rowColors\} modifiers=\{modifiers\}>/
    );
    expect(read("components/ui/AppButton.android.tsx")).toContain(
      "testIDModifier(testID)"
    );
  });
});
