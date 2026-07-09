"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_plugins_1 = require("expo/config-plugins");
/**
 * Configures Android ABI splits so that separate APKs are built for
 * each real-device CPU architecture (arm64-v8a, armeabi-v7a).
 *
 * x86/x86_64 (emulator / ChromeOS) are intentionally excluded: they roughly
 * doubled the native (C++/NDK) compile time in CI while producing APKs nobody
 * ships to a real device. This must stay in sync with `reactNativeArchitectures`
 * in `withGradleBuildTuning.ts` — the split ABIs are a subset of the ABIs that
 * are actually compiled, otherwise a split APK ships with no native libraries.
 *
 * All variants share the same versionCode (no per-ABI offset).
 */
const withAbiSplits = (config) => {
    return (0, config_plugins_1.withAppBuildGradle)(config, (config) => {
        const contents = config.modResults.contents;
        // --- 1. splits block ---
        const splitsConfig = `
    splits {
        abi {
            enable true
            reset()
            include "arm64-v8a", "armeabi-v7a"
            universalApk true
        }
    }
`;
        if (!contents.includes('splits {')) {
            const androidBlockMatch = contents.match(/^android\s*\{[\s\S]*?\n\}/m);
            if (androidBlockMatch) {
                const androidBlock = androidBlockMatch[0];
                const modified = androidBlock.replace(/\n\}$/, splitsConfig + '\n}');
                config.modResults.contents = contents.replace(androidBlock, modified);
                console.log('✓ Added splits configuration to build.gradle');
            }
        }
        else {
            // Splits already present (a re-prebuild without --clean). Rewrite the
            // `include` line in place so a stale ABI list (e.g. a previously-generated
            // x86_64) is dropped and stays in sync with the block above.
            const includeRe = /include\s+"arm64-v8a"[^\n]*/;
            if (includeRe.test(contents)) {
                config.modResults.contents = contents.replace(includeRe, 'include "arm64-v8a", "armeabi-v7a"');
                console.log('✓ Updated splits include list in build.gradle');
            }
            else {
                console.log('ℹ splits already configured in build.gradle');
            }
        }
        return config;
    });
};
exports.default = (0, config_plugins_1.createRunOncePlugin)(withAbiSplits, 'withAbiSplits', '1.0.0');
