import { ConfigPlugin, withAppBuildGradle, createRunOncePlugin } from 'expo/config-plugins';

/**
 * Configures Android ABI splits so that separate APKs are built for
 * the real-device CPU architecture published by the independent core Release.
 *
 * x86_64 remains available through a command-line architecture override for
 * emulator builds. armeabi-v7a is excluded because the core Release does not
 * publish a matching native library. This must stay in sync with
 * `reactNativeArchitectures` in `withGradleBuildTuning.ts`.
 *
 * All variants share the same versionCode (no per-ABI offset).
 */
const withAbiSplits: ConfigPlugin = (config) => {
  return withAppBuildGradle(config, (config) => {
    const contents = config.modResults.contents;

    // --- 1. splits block ---
    const splitsConfig = `
    splits {
        abi {
            enable true
            reset()
            include "arm64-v8a"
            universalApk false
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
    } else {
      // Splits already present (a re-prebuild without --clean). Rewrite the
      // `include` line in place so stale ABIs are dropped and stay in sync with
      // the independent core Release.
      const includeRe = /include\s+"arm64-v8a"[^\n]*/;
      if (includeRe.test(contents)) {
        config.modResults.contents = contents.replace(includeRe, 'include "arm64-v8a"');
        console.log('✓ Updated splits include list in build.gradle');
      } else {
        console.log('ℹ splits already configured in build.gradle');
      }
    }

    config.modResults.contents = config.modResults.contents.replace(
      /universalApk\s+(true|false)/,
      'universalApk false'
    );

    return config;
  });
};

export default createRunOncePlugin(withAbiSplits, 'withAbiSplits', '1.0.0');
