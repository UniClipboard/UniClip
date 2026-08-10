import {
  ConfigPlugin,
  withDangerousMod,
  withAndroidStyles,
  AndroidConfig,
  createRunOncePlugin,
} from 'expo/config-plugins';
import * as fs from 'fs';
import * as path from 'path';

const SPLASH_RES_DIR = 'plugins/assets/android-splash';

// Directories that are copied verbatim from the template into the generated
// android/app/src/main/res/ tree. All files inside are overwritten on prebuild.
const RES_SUBDIRS = [
  'drawable',
  'drawable-mdpi',
  'drawable-hdpi',
  'drawable-xhdpi',
  'drawable-xxhdpi',
  'drawable-xxxhdpi',
  'drawable-night',
  'drawable-night-mdpi',
  'drawable-night-hdpi',
  'drawable-night-xhdpi',
  'drawable-night-xxhdpi',
  'drawable-night-xxxhdpi',
  'values-night',
];

const copySplashResources = async (projectRoot: string, platformProjectRoot: string) => {
  const templateDir = path.join(projectRoot, SPLASH_RES_DIR);
  const resDir = path.join(platformProjectRoot, 'app/src/main/res');

  for (const subdir of RES_SUBDIRS) {
    const srcDir = path.join(templateDir, subdir);
    const destDir = path.join(resDir, subdir);
    if (!fs.existsSync(srcDir)) continue;

    fs.mkdirSync(destDir, { recursive: true });
    for (const file of fs.readdirSync(srcDir)) {
      fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
    }
  }
};

const withDarkSplashScreen: ConfigPlugin = (config) => {
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      await copySplashResources(
        config.modRequest.projectRoot,
        config.modRequest.platformProjectRoot
      );
      return config;
    },
  ]);

  // The Expo template points `android:windowBackground` at the raw bitmap
  // (@drawable/splashscreen_logo), which stretches it full-screen. Point it at
  // the layer-list (background color + centered logo) instead.
  config = withAndroidStyles(config, (config) => {
    const styles = AndroidConfig.Styles.setStylesItem({
      xml: config.modResults,
      parent: { name: 'Theme.App.SplashScreen' },
      item: AndroidConfig.Resources.buildResourceItem({
        name: 'android:windowBackground',
        value: '@drawable/splashscreen',
      }),
    });
    config.modResults = styles;
    return config;
  });

  return config;
};

export default createRunOncePlugin(withDarkSplashScreen, 'withDarkSplashScreen', '1.0.0');
