"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_plugins_1 = require("expo/config-plugins");
const BASE_APPLICATION_ID = 'app.uniclipboard.android';
/**
 * Appends a suffix to the Android `applicationId` WITHOUT touching the
 * gradle `namespace`.
 *
 * Keeping the namespace pinned at `app.uniclipboard.android` is essential:
 * `BuildConfig` is generated under the namespace package, so the native
 * Kotlin `import app.uniclipboard.android.BuildConfig` and every
 * `ComponentName` class FQN keep resolving. Only the install-time
 * `applicationId` changes, which is what lets a ".dev" build coexist with the
 * production install on one device (FileProvider authorities and
 * `context.packageName` derive from applicationId at runtime, so they isolate
 * automatically).
 */
const withVariantApplicationId = (config, { suffix }) => {
    if (!suffix) {
        // Production: leave the official applicationId untouched.
        return config;
    }
    return (0, config_plugins_1.withAppBuildGradle)(config, (config) => {
        const contents = config.modResults.contents;
        const target = `${BASE_APPLICATION_ID}${suffix}`;
        // Match ONLY the defaultConfig applicationId line (the `applicationId `
        // prefix excludes the `namespace '...'` line, which must stay fixed).
        const applicationIdRe = new RegExp(`applicationId (['"])${BASE_APPLICATION_ID.replace(/\./g, '\\.')}\\1`);
        if (!applicationIdRe.test(contents)) {
            if (contents.includes(`applicationId '${target}'`) ||
                contents.includes(`applicationId "${target}"`)) {
                console.log(`ℹ applicationId already suffixed → ${target}`);
            }
            else {
                console.warn(`⚠ withVariantApplicationId: could not find "applicationId '${BASE_APPLICATION_ID}'" in build.gradle; applicationId left unchanged`);
            }
            return config;
        }
        config.modResults.contents = contents.replace(applicationIdRe, `applicationId '${target}'`);
        console.log(`✓ applicationId → '${target}' (namespace '${BASE_APPLICATION_ID}' unchanged)`);
        return config;
    });
};
exports.default = withVariantApplicationId;
