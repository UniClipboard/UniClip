"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const config_plugins_1 = require("expo/config-plugins");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
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
const copySplashResources = async (projectRoot, platformProjectRoot) => {
    const templateDir = path.join(projectRoot, SPLASH_RES_DIR);
    const resDir = path.join(platformProjectRoot, 'app/src/main/res');
    for (const subdir of RES_SUBDIRS) {
        const srcDir = path.join(templateDir, subdir);
        const destDir = path.join(resDir, subdir);
        if (!fs.existsSync(srcDir))
            continue;
        fs.mkdirSync(destDir, { recursive: true });
        for (const file of fs.readdirSync(srcDir)) {
            fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
        }
    }
};
const withDarkSplashScreen = (config) => {
    config = (0, config_plugins_1.withDangerousMod)(config, [
        'android',
        async (config) => {
            await copySplashResources(config.modRequest.projectRoot, config.modRequest.platformProjectRoot);
            return config;
        },
    ]);
    // The Expo template points `android:windowBackground` at the raw bitmap
    // (@drawable/splashscreen_logo), which stretches it full-screen. Point it at
    // the layer-list (background color + centered logo) instead.
    config = (0, config_plugins_1.withAndroidStyles)(config, (config) => {
        const styles = config_plugins_1.AndroidConfig.Styles.setStylesItem({
            xml: config.modResults,
            parent: { name: 'Theme.App.SplashScreen' },
            item: config_plugins_1.AndroidConfig.Resources.buildResourceItem({
                name: 'android:windowBackground',
                value: '@drawable/splashscreen',
            }),
        });
        config.modResults = styles;
        return config;
    });
    return config;
};
exports.default = (0, config_plugins_1.createRunOncePlugin)(withDarkSplashScreen, 'withDarkSplashScreen', '1.0.0');
