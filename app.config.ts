import { ConfigContext, ExpoConfig } from 'expo/config';

type ExpoPluginEntry = NonNullable<ExpoConfig['plugins']>[number];
type EasExtra = {
  build?: {
    experimental?: Record<string, unknown>;
  };
};

type ExpoExtra = Record<string, unknown> & {
  eas?: EasExtra;
};

/**
 * Dynamic Expo config layered on top of the static `app.json`.
 *
 * `process.env.APP_VARIANT` selects between the production build and a
 * dev build that can coexist with it on the same device:
 *   - "production"                       → official identifiers (no suffix)
 *   - "development" | "preview" | unset  → ".dev" suffix everywhere
 *
 * A ".dev" build gets its own Android applicationId, iOS bundle identifiers
 * (main app + Share/Keyboard extensions) and App Group container, so it can
 * be installed next to the App Store / Play production build without any
 * identity or shared-storage collision.
 *
 * Production MUST be requested explicitly on every release path — the three
 * EAS profiles set APP_VARIANT via eas.json and the CI workflows set it
 * before `expo prebuild`. If it is ever omitted on a production path the
 * build produces ".dev" identifiers that no longer match the hardcoded App
 * Store provisioning profiles, so it FAILS to export/upload — a safe failure
 * that never pollutes the real app.
 */

const VARIANT = process.env.APP_VARIANT ?? 'development';
const IS_PRODUCTION = VARIANT === 'production';

const ID_SUFFIX = IS_PRODUCTION ? '' : '.dev';
const NAME_SUFFIX = IS_PRODUCTION ? '' : ' Dev';

const IOS_BUNDLE_ID = `app.uniclipboard.UniClipboard${ID_SUFFIX}`;
const APP_GROUP = `group.app.uniclipboard.UniClipboard${ID_SUFFIX}`;

// The legacy group is a one-way migration source from the old native Swift
// app; only the production install has data there, so keep it out of dev.
const LEGACY_APP_GROUP = 'group.app.uniclipboard.ios';
const APP_GROUPS = IS_PRODUCTION ? [APP_GROUP, LEGACY_APP_GROUP] : [APP_GROUP];

export default ({ config }: ConfigContext): ExpoConfig => {
  const ios = config.ios ?? {};
  const extra = (config.extra ?? {}) as ExpoExtra;
  const eas = extra.eas ?? {};
  const easBuild = eas.build ?? {};
  const easExperimental = easBuild.experimental ?? {};

  return {
    ...(config as ExpoConfig),
    name: `${config.name ?? 'UniClip'}${NAME_SUFFIX}`,
    ios: {
      ...ios,
      bundleIdentifier: IOS_BUNDLE_ID,
      entitlements: {
        ...(ios.entitlements ?? {}),
        'com.apple.security.application-groups': APP_GROUPS,
      },
      infoPlist: {
        ...(ios.infoPlist ?? {}),
        // Read at runtime by the Swift App Group resolvers (with a hardcoded
        // fallback). Injected for BOTH variants so production also resolves a
        // concrete value rather than relying on the fallback.
        UCAppGroupIdentifier: APP_GROUP,
      },
    },
    extra: {
      ...extra,
      appVariant: VARIANT,
      eas: {
        ...eas,
        build: {
          ...easBuild,
          experimental: {
            ...easExperimental,
            ios: {
              appExtensions: [
                {
                  targetName: 'share',
                  bundleIdentifier: `${IOS_BUNDLE_ID}.Share`,
                  entitlements: {
                    'com.apple.security.application-groups': APP_GROUPS,
                  },
                },
                {
                  targetName: 'keyboard',
                  bundleIdentifier: `${IOS_BUNDLE_ID}.Keyboard`,
                  entitlements: {
                    'com.apple.security.application-groups': APP_GROUPS,
                  },
                },
              ],
            },
          },
        },
      },
    },
    plugins: [
      ...(config.plugins ?? []),
      // Android: suffix the gradle applicationId only (namespace stays fixed).
      ['./plugins/build/withVariantApplicationId.js', { suffix: ID_SUFFIX }] as ExpoPluginEntry,
    ],
  };
};
