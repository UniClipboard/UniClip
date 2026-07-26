import { ConfigPlugin, createRunOncePlugin, withMod } from 'expo/config-plugins';

type XcodeTarget = {
  props: {
    productName?: string;
  };
  setBuildSetting: (name: string, value: string) => void;
};

type XcodeProject = {
  rootObject: {
    props: {
      targets: XcodeTarget[];
    };
  };
};

const EXTENSION_TARGET_NAMES = new Set(['share', 'keyboard']);

const withExtensionP2PKeychainGroup: ConfigPlugin = (config) => {
  const keychainAccessGroup = config.ios?.infoPlist?.UCP2PKeychainAccessGroup;

  if (typeof keychainAccessGroup !== 'string' || !keychainAccessGroup) {
    throw new Error(
      'withExtensionP2PKeychainGroup requires ios.infoPlist.UCP2PKeychainAccessGroup'
    );
  }

  return withMod(config, {
    platform: 'ios',
    mod: 'xcodeProjectBeta2' as never,
    action: async (config) => {
      const project = config.modResults as XcodeProject;
      const extensionTargets = project.rootObject.props.targets.filter((target) =>
        EXTENSION_TARGET_NAMES.has(target.props.productName ?? '')
      );

      if (extensionTargets.length !== EXTENSION_TARGET_NAMES.size) {
        const found =
          extensionTargets.map((target) => target.props.productName).join(', ') || 'none';
        throw new Error(
          `withExtensionP2PKeychainGroup expected share and keyboard targets, found: ${found}`
        );
      }

      for (const target of extensionTargets) {
        target.setBuildSetting('UCP2P_KEYCHAIN_ACCESS_GROUP', keychainAccessGroup);
      }

      return config;
    },
  });
};

export default createRunOncePlugin(
  withExtensionP2PKeychainGroup,
  'withExtensionP2PKeychainGroup',
  '1.0.0'
);
