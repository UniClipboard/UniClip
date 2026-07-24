import { ConfigPlugin, createRunOncePlugin, withProjectBuildGradle } from 'expo/config-plugins';

const RELEASE_REPOSITORY =
  'maven { url uri("$rootDir/../modules/uc-engine/android/release-maven") }';

const withUnifiedEngineRelease: ConfigPlugin = (config) =>
  withProjectBuildGradle(config, (config) => {
    const contents = config.modResults.contents;
    if (contents.includes(RELEASE_REPOSITORY)) return config;

    const repositoriesBlock = 'allprojects {\n  repositories {';
    if (!contents.includes(repositoriesBlock)) {
      throw new Error('Cannot add the unified engine Release repository to android/build.gradle');
    }

    config.modResults.contents = contents.replace(
      repositoriesBlock,
      `${repositoriesBlock}\n    ${RELEASE_REPOSITORY}`
    );
    return config;
  });

export default createRunOncePlugin(withUnifiedEngineRelease, 'withUnifiedEngineRelease', '1.0.0');
