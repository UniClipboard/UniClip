"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_plugins_1 = require("expo/config-plugins");
const ANDROID_KEY = 'app.uniclipboard.analytics.POSTHOG_PROJECT_KEY';
const EXTENSION_TARGET_NAMES = new Set(['share', 'keyboard']);
const withPostHogAnalytics = (config) => {
    const projectKey = process.env.POSTHOG_PROJECT_KEY?.trim() ?? '';
    config = (0, config_plugins_1.withInfoPlist)(config, (modConfig) => {
        modConfig.modResults.UCPostHogProjectKey = projectKey;
        return modConfig;
    });
    config = (0, config_plugins_1.withAndroidManifest)(config, (modConfig) => {
        const application = config_plugins_1.AndroidConfig.Manifest.getMainApplicationOrThrow(modConfig.modResults);
        config_plugins_1.AndroidConfig.Manifest.addMetaDataItemToMainApplication(application, ANDROID_KEY, projectKey);
        return modConfig;
    });
    return (0, config_plugins_1.withMod)(config, {
        platform: 'ios',
        mod: 'xcodeProjectBeta2',
        action: async (modConfig) => {
            const project = modConfig.modResults;
            const extensionTargets = project.rootObject.props.targets.filter((target) => EXTENSION_TARGET_NAMES.has(target.props.productName ?? ''));
            if (extensionTargets.length !== EXTENSION_TARGET_NAMES.size) {
                const found = extensionTargets.map((target) => target.props.productName).join(', ') || 'none';
                throw new Error(`withPostHogAnalytics expected share and keyboard targets, found: ${found}`);
            }
            for (const target of extensionTargets) {
                target.setBuildSetting('UC_POSTHOG_PROJECT_KEY', projectKey);
            }
            return modConfig;
        },
    });
};
exports.default = (0, config_plugins_1.createRunOncePlugin)(withPostHogAnalytics, 'withPostHogAnalytics', '1.0.0');
