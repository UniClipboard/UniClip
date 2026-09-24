/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'share',
  name: 'share',
  // Variant-suffixed so the share sheet distinguishes the dev/test installs
  // from the App Store one when they are on the same device.
  displayName:
    { production: 'UniClip', test: 'UniClip Test' }[config.extra?.appVariant] ?? 'UniClip Dev',
  // Leading dot → appended to the main app bundle id, so it follows the
  // variant automatically (…UniClipboard.Share / …UniClipboard.dev.Share).
  bundleIdentifier: '.Share',
  deploymentTarget: '16.4',
  exportJs: false,
  entitlements: {
    'com.apple.security.application-groups':
      config.ios.entitlements['com.apple.security.application-groups'],
    'keychain-access-groups': config.ios.entitlements['keychain-access-groups'],
  },
});
