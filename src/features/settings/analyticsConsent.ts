export interface AnalyticsConsentApi {
  getAnalyticsConsent(): Promise<boolean>;
  setAnalyticsConsent(enabled: boolean): Promise<void>;
  resetAnalyticsIdentity(): Promise<void>;
}

let api: AnalyticsConsentApi | null = null;

export function configureAnalyticsConsent(nextApi: AnalyticsConsentApi): void {
  api = nextApi;
}

function configuredApi(): AnalyticsConsentApi {
  if (!api) throw new Error('Analytics consent is not configured');
  return api;
}

export function getAnalyticsConsent(): Promise<boolean> {
  return configuredApi().getAnalyticsConsent();
}

export function setAnalyticsConsent(enabled: boolean): Promise<void> {
  return configuredApi().setAnalyticsConsent(enabled);
}

export function resetAnalyticsIdentity(): Promise<void> {
  return configuredApi().resetAnalyticsIdentity();
}
