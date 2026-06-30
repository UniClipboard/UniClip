/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'share',
  name: 'share',
  displayName: 'UniClip',
  bundleIdentifier: 'app.uniclipboard.ios.Share',
  deploymentTarget: '17.0',
  exportJs: false,
  entitlements: {
    'com.apple.security.application-groups':
      config.ios.entitlements['com.apple.security.application-groups'],
  },
});
