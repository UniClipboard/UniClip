/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'keyboard',
  name: 'keyboard',
  displayName: 'UniClip',
  // Leading dot → appended to the main app bundle id, so it follows the
  // dev/prod variant automatically (…UniClipboard.Keyboard / …UniClipboard.dev.Keyboard).
  bundleIdentifier: '.Keyboard',
  deploymentTarget: '16.4',
  exportJs: false,
  entitlements: {
    'com.apple.security.application-groups':
      config.ios.entitlements['com.apple.security.application-groups'],
  },
});
