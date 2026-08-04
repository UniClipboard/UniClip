export { ConfigStorage, configStorage, CONFIG_USER_STATE_KEY } from './internal/configStorage';
export {
  configureAnalyticsConsent,
  getAnalyticsConsent,
  resetAnalyticsIdentity,
  setAnalyticsConsent,
  type AnalyticsConsentApi,
} from './analyticsConsent';
export { useSettingsStore } from './store';
export type { UpdateConfigResult } from './store';
