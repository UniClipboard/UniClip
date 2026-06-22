const { withXcodeProject, withDangerousMod } = require('expo/config-plugins');
const path = require('path');
const fs = require('fs');

function withRustCoreIOS(config) {
  return withXcodeProject(config, async (config) => {
    const project = config.modResults;
    const moduleIosDir = path.resolve(
      config.modRequest.projectRoot,
      'modules/uc-core/ios'
    );
    const xcframeworkPath = path.join(
      moduleIosDir,
      'UniClipboardCore.xcframework'
    );

    if (!fs.existsSync(xcframeworkPath)) {
      console.warn(
        '[withRustCore] UniClipboardCore.xcframework not found at',
        xcframeworkPath,
        '— run rust-core/scripts/build-ios.sh first'
      );
    }

    return config;
  });
}

module.exports = function withRustCore(config) {
  config = withRustCoreIOS(config);
  return config;
};
