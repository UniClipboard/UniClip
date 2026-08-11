import { ConfigPlugin, createRunOncePlugin, withDangerousMod } from 'expo/config-plugins';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Locks the main Activity to portrait on phones while leaving tablets
 * (sw600dp+) free to rotate. The manifest cannot express a device-class
 * condition, so the check happens in MainActivity.onCreate before the
 * React root is rendered.
 */
const MARKER = 'Lock phones (non-tablets) to portrait orientation';

const ORIENTATION_LOCK = `
    // Lock phones (non-tablets) to portrait orientation; tablets keep all orientations.
    if (resources.configuration.smallestScreenWidthDp < 600) {
      requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
    }
`;

const ANCHOR = 'setTheme(R.style.AppTheme);';

function findMainActivity(dir: string): string | null {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findMainActivity(full);
      if (found) return found;
    } else if (entry.name === 'MainActivity.kt') {
      return full;
    }
  }
  return null;
}

const withAndroidOrientation: ConfigPlugin = (config) => {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const javaRoot = path.join(modConfig.modRequest.platformProjectRoot, 'app/src/main/java');

      const mainActivity = findMainActivity(javaRoot);
      if (!mainActivity) {
        throw new Error('withAndroidOrientation: MainActivity.kt not found');
      }

      let contents = fs.readFileSync(mainActivity, 'utf8');
      if (contents.includes(MARKER)) return modConfig;

      if (!contents.includes(ANCHOR)) {
        throw new Error('withAndroidOrientation: unexpected MainActivity.kt template');
      }

      contents = contents.replace(ANCHOR, `${ANCHOR}${ORIENTATION_LOCK}`);
      fs.writeFileSync(mainActivity, contents);
      return modConfig;
    },
  ]);
};

export default createRunOncePlugin(withAndroidOrientation, 'withAndroidOrientation', '1.0.0');
