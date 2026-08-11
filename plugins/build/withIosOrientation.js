"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_plugins_1 = require("expo/config-plugins");
const Orientation_1 = require("@expo/config-plugins/build/ios/Orientation");
/**
 * Restricts the iPhone (non-iPad) interface orientations to portrait only.
 * The iPad key (UISupportedInterfaceOrientations~ipad) is left untouched, so
 * tablets keep the full orientation set configured in app.json.
 */
const withIosOrientation = (config) => {
    return (0, config_plugins_1.withInfoPlist)(config, (modConfig) => {
        modConfig.modResults.UISupportedInterfaceOrientations = Orientation_1.PORTRAIT_ORIENTATIONS;
        return modConfig;
    });
};
exports.default = (0, config_plugins_1.createRunOncePlugin)(withIosOrientation, 'withIosOrientation', '1.0.0');
