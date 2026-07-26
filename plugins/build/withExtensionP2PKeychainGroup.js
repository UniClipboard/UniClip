"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_plugins_1 = require("expo/config-plugins");
const EXTENSION_TARGET_NAMES = new Set(['share', 'keyboard']);
const withExtensionP2PKeychainGroup = (config) => {
    const keychainAccessGroup = config.ios?.infoPlist?.UCP2PKeychainAccessGroup;
    if (typeof keychainAccessGroup !== 'string' || !keychainAccessGroup) {
        throw new Error('withExtensionP2PKeychainGroup requires ios.infoPlist.UCP2PKeychainAccessGroup');
    }
    return (0, config_plugins_1.withMod)(config, {
        platform: 'ios',
        mod: 'xcodeProjectBeta2',
        action: async (config) => {
            const project = config.modResults;
            const extensionTargets = project.rootObject.props.targets.filter((target) => EXTENSION_TARGET_NAMES.has(target.props.productName ?? ''));
            if (extensionTargets.length !== EXTENSION_TARGET_NAMES.size) {
                const found = extensionTargets.map((target) => target.props.productName).join(', ') || 'none';
                throw new Error(`withExtensionP2PKeychainGroup expected share and keyboard targets, found: ${found}`);
            }
            for (const target of extensionTargets) {
                target.setBuildSetting('UCP2P_KEYCHAIN_ACCESS_GROUP', keychainAccessGroup);
            }
            return config;
        },
    });
};
exports.default = (0, config_plugins_1.createRunOncePlugin)(withExtensionP2PKeychainGroup, 'withExtensionP2PKeychainGroup', '1.0.0');
