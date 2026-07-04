"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_plugins_1 = require("expo/config-plugins");
/**
 * Adds permissions required by the clipboard overlay feature to AndroidManifest.xml:
 * - SYSTEM_ALERT_WINDOW: draw the focus-grabbing overlay window.
 * - READ_LOGS: let the background monitor watch "ClipboardService:E" denial lines
 *   to detect background copies. This is a signature|privileged permission, so it
 *   must still be granted manually via adb; declaring it here is a prerequisite:
 *     adb shell pm grant <package> android.permission.READ_LOGS
 */
function addOverlayPermission(androidManifest) {
    const { manifest } = androidManifest;
    if (!manifest['uses-permission']) {
        manifest['uses-permission'] = [];
    }
    const requiredPermissions = [
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.READ_LOGS',
    ];
    for (const perm of requiredPermissions) {
        const exists = manifest['uses-permission'].some((p) => p.$?.['android:name'] === perm);
        if (!exists) {
            manifest['uses-permission'].push({
                $: { 'android:name': perm },
            });
            console.log(`✓ Added permission: ${perm}`);
        }
    }
    return androidManifest;
}
const withClipboardOverlayPermission = (config) => {
    return (0, config_plugins_1.withAndroidManifest)(config, (config) => {
        config.modResults = addOverlayPermission(config.modResults);
        return config;
    });
};
exports.default = (0, config_plugins_1.createRunOncePlugin)(withClipboardOverlayPermission, 'withClipboardOverlayPermission', '1.0.0');
