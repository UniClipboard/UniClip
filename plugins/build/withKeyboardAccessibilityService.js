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
const SERVICE_CLASS = 'expo.modules.clipboardoverlay.KeyboardWatchAccessibilityService';
/**
 * Accessibility service config. canRetrieveWindowContent=true is required for
 * getWindows() to return a non-empty list on many ROMs (HyperOS), but the
 * service only ever inspects window *types* to detect the IME window — it never
 * reads node content.
 */
const A11Y_CONFIG_XML = `<?xml version="1.0" encoding="utf-8"?>
<accessibility-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:accessibilityEventTypes="typeWindowStateChanged|typeWindowsChanged"
    android:accessibilityFeedbackType="feedbackGeneric"
    android:accessibilityFlags="flagRetrieveInteractiveWindows"
    android:canRetrieveWindowContent="true"
    android:description="@string/keyboard_watch_a11y_description"
    android:notificationTimeout="100" />
`;
const A11Y_STRINGS_XML = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="keyboard_watch_a11y_description">仅用于检测键盘是否弹出，以便在你打字时暂停后台剪贴板读取。本服务不会读取任何屏幕内容。</string>
</resources>
`;
function addService(androidManifest) {
    const application = androidManifest.manifest.application?.[0];
    if (!application)
        return androidManifest;
    if (!application.service)
        application.service = [];
    const exists = application.service.some((s) => s.$?.['android:name'] === SERVICE_CLASS);
    if (!exists) {
        application.service.push({
            $: {
                'android:name': SERVICE_CLASS,
                'android:exported': 'false',
                'android:permission': 'android.permission.BIND_ACCESSIBILITY_SERVICE',
            },
            'intent-filter': [
                {
                    action: [{ $: { 'android:name': 'android.accessibilityservice.AccessibilityService' } }],
                },
            ],
            'meta-data': [
                {
                    $: {
                        'android:name': 'android.accessibilityservice',
                        'android:resource': '@xml/keyboard_accessibility_service',
                    },
                },
            ],
        });
        console.log(`✓ Registered accessibility service: ${SERVICE_CLASS}`);
    }
    return androidManifest;
}
const withKeyboardAccessibilityService = (config) => {
    config = (0, config_plugins_1.withDangerousMod)(config, [
        'android',
        async (config) => {
            const resMain = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res');
            const xmlDir = path.join(resMain, 'xml');
            if (!fs.existsSync(xmlDir))
                fs.mkdirSync(xmlDir, { recursive: true });
            fs.writeFileSync(path.join(xmlDir, 'keyboard_accessibility_service.xml'), A11Y_CONFIG_XML, 'utf-8');
            const valuesDir = path.join(resMain, 'values');
            if (!fs.existsSync(valuesDir))
                fs.mkdirSync(valuesDir, { recursive: true });
            fs.writeFileSync(path.join(valuesDir, 'strings_keyboard_a11y.xml'), A11Y_STRINGS_XML, 'utf-8');
            return config;
        },
    ]);
    config = (0, config_plugins_1.withAndroidManifest)(config, (config) => {
        config.modResults = addService(config.modResults);
        return config;
    });
    return config;
};
exports.default = (0, config_plugins_1.createRunOncePlugin)(withKeyboardAccessibilityService, 'withKeyboardAccessibilityService', '1.0.0');
