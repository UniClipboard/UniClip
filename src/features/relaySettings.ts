import { createLogger } from '@/support/observability';

export interface RelaySaveResult {
  configured: boolean;
}

export interface RelaySettingsApi {
  saveCustomRelayNode(
    url: string,
    accessToken: string,
    previousUrl?: string
  ): Promise<RelaySaveResult>;
  rebuildRelayEndpoint(): Promise<void>;
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

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Relay address must be a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Relay address must use HTTP or HTTPS');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Relay address cannot include a username or password');
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Relay address must not include a path, query, or fragment');
  }
  return parsed.href.replace(/\/$/, '');
}

export async function saveCustomRelay(input: {
  url: string;
  accessToken: string;
  previousUrl?: string;
}): Promise<RelaySaveResult> {
  const url = normalizeRelayUrl(input.url);
  const accessToken = input.accessToken.trim();
  const result = await (input.previousUrl === undefined
    ? configuredApi().saveCustomRelayNode(url, accessToken)
    : configuredApi().saveCustomRelayNode(url, accessToken, input.previousUrl));

  const rebuildStartedAt = Date.now();
  await configuredApi().rebuildRelayEndpoint();
  log.info(
    `relay save completed configured=${result.configured} customRelayConfigured=${
      url.length > 0
    } credentialProvided=${accessToken.length > 0} endpointRebuilt=true rebuildDurationMs=${
      Date.now() - rebuildStartedAt
    }`
  );
  return result;
}
