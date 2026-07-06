import { ConfigPlugin } from 'expo/config-plugins';
export interface VariantApplicationIdProps {
    /**
     * Suffix appended to the Android `applicationId`, e.g. ".dev".
     * An empty string is a no-op (production keeps the official id).
     */
    suffix: string;
}
/**
 * Appends a suffix to the Android `applicationId` WITHOUT touching the
 * gradle `namespace`.
 *
 * Keeping the namespace pinned at `app.uniclipboard.android` is essential:
 * `BuildConfig` is generated under the namespace package, so the native
 * Kotlin `import app.uniclipboard.android.BuildConfig` and every
 * `ComponentName` class FQN keep resolving. Only the install-time
 * `applicationId` changes, which is what lets a ".dev" build coexist with the
 * production install on one device (FileProvider authorities and
 * `context.packageName` derive from applicationId at runtime, so they isolate
 * automatically).
 */
declare const withVariantApplicationId: ConfigPlugin<VariantApplicationIdProps>;
export default withVariantApplicationId;
