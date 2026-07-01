/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'keyboard',
  name: 'keyboard',
  displayName: 'UniClip Keyboard',
  bundleIdentifier: 'app.uniclipboard.UniClipboard.Keyboard',
  deploymentTarget: '17.0',
  exportJs: false,
  entitlements: {
    'com.apple.security.application-groups':
      config.ios.entitlements['com.apple.security.application-groups'],
  },
});
