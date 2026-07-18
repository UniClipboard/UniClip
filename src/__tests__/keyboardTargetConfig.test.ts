/// <reference types="jest" />
/// <reference types="node" />

const configureKeyboardTarget =
  require('../../targets/keyboard/expo-target.config.js') as (config: {
    ios: {
      entitlements: Record<string, string[]>;
    };
  }) => { displayName: string };

it('uses the short UniClip keyboard display name', () => {
  const target = configureKeyboardTarget({
    ios: {
      entitlements: {
        'com.apple.security.application-groups': ['group.example'],
      },
    },
  });

  expect(target.displayName).toBe('UniClip');
});
