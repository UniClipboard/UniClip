const fs = require('node:fs/promises');
const path = require('node:path');
const { IOSConfig, withXcodeProject } = require('expo/config-plugins');

module.exports = function withIosSettingsBundle(config) {
  return withXcodeProject(config, async (config) => {
    const projectRoot = config.modRequest.projectRoot;
    const platformRoot = config.modRequest.platformProjectRoot;
    const projectName = IOSConfig.XcodeUtils.getProjectName(projectRoot);
    const source = path.join(projectRoot, 'resources/ios/Settings.bundle');
    const destination = path.join(platformRoot, projectName, 'Settings.bundle');

    await fs.rm(destination, { recursive: true, force: true });
    await fs.cp(source, destination, { recursive: true });

    const project = config.modResults;
    IOSConfig.XcodeUtils.ensureGroupRecursively(project, projectName);
    IOSConfig.XcodeUtils.addResourceFileToGroup({
      filepath: path.relative(platformRoot, destination),
      groupName: projectName,
      project,
      isBuildFile: true,
      verbose: true,
    });

    return config;
  });
};
