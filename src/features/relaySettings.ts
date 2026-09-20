import { createLogger } from '@/support/observability';

export interface CustomRelay {
  url: string;
  credentialConfigured: boolean;
}

export type RelayMutationRejection = 'invalidUrl' | 'duplicate' | 'notFound';
export interface RelayMutationResult {
  relays: CustomRelay[];
  rejection?: RelayMutationRejection;
}
export interface RelaySettingsApi {
  queryCustomRelays(): Promise<CustomRelay[]>;
  addCustomRelay(url: string, accessToken: string): Promise<RelayMutationResult>;
  editCustomRelay(previousUrl: string, url: string, accessToken: string): Promise<RelayMutationResult>;
  deleteCustomRelay(url: string): Promise<RelayMutationResult>;
  rebuildRelayEndpoint(): Promise<void>;
}
export interface RelaySaveOutcome extends RelayMutationResult {
  connection: Promise<'rebuilt' | 'retrying' | 'unchanged'>;
}

let api: RelaySettingsApi | null = null;
const log = createLogger('RelaySettings');

export function configureRelaySettings(nextApi: RelaySettingsApi): void {
  api = nextApi;
}
function configuredApi(): RelaySettingsApi {
  if (!api) throw new Error('Relay settings are not configured');
  return api;
}

function normalizeRelayUrl(value: string): string {
  const url = value.trim();
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    if (parsed.username || parsed.password) return '';
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) return '';
    return parsed.href.replace(/\/$/, '');
  } catch {
    return '';
  }
}

async function importLegacyRelays(candidates: string[], index = 0): Promise<void> {
  const url = candidates[index];
  if (!url) return;
  const result = await configuredApi().addCustomRelay(url, '');
  log.info(
    `relay migration engine result outcome=${result.rejection ?? 'saved'} relayCount=${result.relays.length}`
  );
  await importLegacyRelays(candidates, index + 1);
}

export async function refreshCustomRelays(legacyUrls: string[] = []): Promise<CustomRelay[]> {
  log.info(`relay refresh started legacyCount=${legacyUrls.length}`);
  let relays = await configuredApi().queryCustomRelays();
  const known = new Set(relays.map(({ url }) => normalizeRelayUrl(url)).filter(Boolean));
  const candidates = [...new Set(legacyUrls.map(normalizeRelayUrl).filter(Boolean))].filter(
    (url) => !known.has(url)
  );
  await importLegacyRelays(candidates);
  if (candidates.length > 0) relays = await configuredApi().queryCustomRelays();
  const confirmed = new Set(relays.map(({ url }) => normalizeRelayUrl(url)).filter(Boolean));
  if (candidates.some((url) => !confirmed.has(url))) {
    throw new Error('Engine did not confirm every legacy relay migration');
  }
  log.info(`relay refresh completed relayCount=${relays.length} migratedCount=${candidates.length}`);
  return relays;
}

export async function saveCustomRelay(input: {
  url: string;
  accessToken: string;
  previousUrl?: string;
}): Promise<RelaySaveOutcome> {
  const url = normalizeRelayUrl(input.url) || input.url.trim();
  const accessToken = input.accessToken.trim();
  const operation = input.previousUrl === undefined ? 'add' : url ? 'edit' : 'delete';
  log.info(`relay save started operation=${operation} credentialProvided=${accessToken.length > 0}`);
  let result: RelayMutationResult;
  if (input.previousUrl === undefined) {
    result = await configuredApi().addCustomRelay(url, accessToken);
  } else if (url) {
    result = await configuredApi().editCustomRelay(input.previousUrl, url, accessToken);
  } else {
    result = await configuredApi().deleteCustomRelay(input.previousUrl);
  }
  log.info(
    `relay engine write result operation=${operation} outcome=${result.rejection ?? 'saved'} relayCount=${result.relays.length}`
  );
  if (result.rejection) {
    const relays = await refreshCustomRelays();
    return { relays, rejection: result.rejection, connection: Promise.resolve('unchanged') };
  }
  const connection = (async (): Promise<'rebuilt' | 'retrying'> => {
    const rebuildStartedAt = Date.now();
    try {
      await configuredApi().rebuildRelayEndpoint();
      log.info(`relay network rebuild outcome=success durationMs=${Date.now() - rebuildStartedAt}`);
      return 'rebuilt';
    } catch {
      log.warn(`relay network rebuild outcome=retrying durationMs=${Date.now() - rebuildStartedAt}`);
      return 'retrying';
    }
  })();
  return { relays: result.relays, connection };
}
