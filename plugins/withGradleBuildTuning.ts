import { ConfigPlugin, withGradleProperties } from 'expo/config-plugins';

/**
 * Tunes the generated `android/gradle.properties` for faster builds.
 *
 * ## Why
 *
 * `assembleRelease` is dominated by native (C++/NDK) compilation, and that cost
 * scales linearly with the number of ABIs. The React Native template default,
 * `reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64`, compiles the full
 * native stack (RN C++ + Hermes + the UniFFI `uc-core` `.so`) four times. In CI
 * that step alone took ~22 min.
 *
 * x86/x86_64 only matter for x86 emulators / ChromeOS — never for a shipped
 * device build, and Apple Silicon dev machines run arm64-v8a emulators anyway.
 * Restricting to the two real-device ABIs roughly halves native compile time.
 *
 * Keep this in sync with `withAbiSplits.ts`: the split/output ABIs must be a
 * subset of what is compiled here, or a split APK ships with no native libs.
 *
 * Also enables the Gradle build cache so unchanged task outputs (Java/Kotlin/
 * resources) are reused across CI runs via the `setup-gradle` action cache.
 */
const REAL_DEVICE_ABIS = 'armeabi-v7a,arm64-v8a';

const withGradleBuildTuning: ConfigPlugin = (config) =>
  withGradleProperties(config, (config) => {
    const props = config.modResults;

    const setProperty = (key: string, value: string) => {
      const existing = props.find((item) => item.type === 'property' && item.key === key);
      if (existing && existing.type === 'property') {
        existing.value = value;
      } else {
        props.push({ type: 'property', key, value });
      }
    };

    setProperty('reactNativeArchitectures', REAL_DEVICE_ABIS);
    setProperty('org.gradle.caching', 'true');

    return config;
  });

export default withGradleBuildTuning;
