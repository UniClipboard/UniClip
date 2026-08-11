import { ConfigPlugin, createRunOncePlugin, withInfoPlist } from 'expo/config-plugins';
import { PORTRAIT_ORIENTATIONS } from '@expo/config-plugins/build/ios/Orientation';

/**
 * Restricts the iPhone (non-iPad) interface orientations to portrait only.
 * The iPad key (UISupportedInterfaceOrientations~ipad) is left untouched, so
 * tablets keep the full orientation set configured in app.json.
 */
const withIosOrientation: ConfigPlugin = (config) => {
  return withInfoPlist(config, (modConfig) => {
    modConfig.modResults.UISupportedInterfaceOrientations = PORTRAIT_ORIENTATIONS;
    return modConfig;
  });
};

export default createRunOncePlugin(withIosOrientation, 'withIosOrientation', '1.0.0');
