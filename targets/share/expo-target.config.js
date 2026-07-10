/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'share',
  name: 'share',
  // Variant-suffixed so the share sheet distinguishes the dev install from
  // the App Store one when both are on the same device.
  displayName: config.extra?.appVariant === 'production' ? 'UniClip' : 'UniClip Dev',
  // Leading dot → appended to the main app bundle id, so it follows the
  // dev/prod variant automatically (…UniClipboard.Share / …UniClipboard.dev.Share).
  bundleIdentifier: '.Share',
  deploymentTarget: '17.0',
  exportJs: false,
  entitlements: {
    'com.apple.security.application-groups':
      config.ios.entitlements['com.apple.security.application-groups'],
  },
});
