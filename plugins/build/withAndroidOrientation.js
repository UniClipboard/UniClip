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
function findMainActivity(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const found = findMainActivity(full);
            if (found)
                return found;
        }
        else if (entry.name === 'MainActivity.kt') {
            return full;
        }
    }
    return null;
}
const withAndroidOrientation = (config) => {
    return (0, config_plugins_1.withDangerousMod)(config, [
        'android',
        async (modConfig) => {
            const javaRoot = path.join(modConfig.modRequest.platformProjectRoot, 'app/src/main/java');
            const mainActivity = findMainActivity(javaRoot);
            if (!mainActivity) {
                throw new Error('withAndroidOrientation: MainActivity.kt not found');
            }
            let contents = fs.readFileSync(mainActivity, 'utf8');
            if (contents.includes(MARKER))
                return modConfig;
            if (!contents.includes(ANCHOR)) {
                throw new Error('withAndroidOrientation: unexpected MainActivity.kt template');
            }
            contents = contents.replace(ANCHOR, `${ANCHOR}${ORIENTATION_LOCK}`);
            fs.writeFileSync(mainActivity, contents);
            return modConfig;
        },
    ]);
};
exports.default = (0, config_plugins_1.createRunOncePlugin)(withAndroidOrientation, 'withAndroidOrientation', '1.0.0');
