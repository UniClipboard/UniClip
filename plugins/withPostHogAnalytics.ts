import {
  AndroidConfig,
  ConfigPlugin,
  createRunOncePlugin,
  withAndroidManifest,
  withInfoPlist,
  withMod,
} from 'expo/config-plugins';

type XcodeTarget = {
  props: { productName?: string };
  setBuildSetting: (name: string, value: string) => void;
};

type XcodeProject = {
  rootObject: { props: { targets: XcodeTarget[] } };
};

const ANDROID_KEY = 'app.uniclipboard.analytics.POSTHOG_PROJECT_KEY';
const EXTENSION_TARGET_NAMES = new Set(['share', 'keyboard']);

const withPostHogAnalytics: ConfigPlugin = (config) => {
  const projectKey = process.env.POSTHOG_PROJECT_KEY?.trim() ?? '';

  config = withInfoPlist(config, (modConfig) => {
    modConfig.modResults.UCPostHogProjectKey = projectKey;
    return modConfig;
  });

  config = withAndroidManifest(config, (modConfig) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(modConfig.modResults);
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(application, ANDROID_KEY, projectKey);
    return modConfig;
  });

  return withMod(config, {
    platform: 'ios',
    mod: 'xcodeProjectBeta2' as never,
    action: async (modConfig) => {
      const project = modConfig.modResults as XcodeProject;
      const extensionTargets = project.rootObject.props.targets.filter((target) =>
        EXTENSION_TARGET_NAMES.has(target.props.productName ?? '')
      );

      if (extensionTargets.length !== EXTENSION_TARGET_NAMES.size) {
        const found =
          extensionTargets.map((target) => target.props.productName).join(', ') || 'none';
        throw new Error(
          `withPostHogAnalytics expected share and keyboard targets, found: ${found}`
        );
      }

      for (const target of extensionTargets) {
        target.setBuildSetting('UC_POSTHOG_PROJECT_KEY', projectKey);
      }
      return modConfig;
    },
  });
};

export default createRunOncePlugin(withPostHogAnalytics, 'withPostHogAnalytics', '1.0.0');
