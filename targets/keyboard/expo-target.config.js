/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'keyboard',
  name: 'keyboard',
  // Variant-suffixed so the system keyboard list distinguishes the dev
  // install from the App Store one when both are on the same device.
  displayName:
    config.extra?.appVariant === 'production' ? 'UniClip Keyboard' : 'UniClip Keyboard Dev',
  // Leading dot → appended to the main app bundle id, so it follows the
  // dev/prod variant automatically (…UniClipboard.Keyboard / …UniClipboard.dev.Keyboard).
  bundleIdentifier: '.Keyboard',
  deploymentTarget: '17.0',
  exportJs: false,
  entitlements: {
    'com.apple.security.application-groups':
      config.ios.entitlements['com.apple.security.application-groups'],
  },
});
