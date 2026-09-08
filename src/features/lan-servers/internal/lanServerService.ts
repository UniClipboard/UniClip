import type {
  LanServerDraft,
  LanServerProfile,
  LanServerSecretPort,
  LanServerSettingsPort,
} from '../contracts';

export interface LanServerServiceDependencies {
  settings: LanServerSettingsPort;
  secrets: LanServerSecretPort;
  createId(): string;
}

export class LanServerService {
  constructor(private readonly dependencies: LanServerServiceDependencies) {}

  async save(
    draft: LanServerDraft,
    serverId?: string,
    options: { activate?: boolean } = {}
  ): Promise<LanServerProfile> {
    const current = await this.dependencies.settings.read();
    const id = serverId ?? this.dependencies.createId();
    const existingIndex = current.servers.findIndex((server) => server.id === id);
    if (serverId && existingIndex < 0) throw new Error('LAN server not found');
    const profile = this.profileFromDraft(id, draft);
    const previousPassword = serverId ? await this.dependencies.secrets.get(id) : null;
    const servers = [...current.servers];
    if (existingIndex >= 0) servers[existingIndex] = profile;
    else servers.push(profile);

    await this.dependencies.secrets.set(profile.id, draft.password);
    try {
      await this.dependencies.settings.write({
        servers,
        ...(options.activate ? { syncChannel: 'lan' as const } : {}),
      });
    } catch (error) {
      if (previousPassword !== null) {
        await this.dependencies.secrets.set(profile.id, previousPassword).catch(() => undefined);
      } else {
        await this.dependencies.secrets.delete(profile.id).catch(() => undefined);
      }
      throw error;
    }
    return profile;
  }

  async getDraft(serverId: string): Promise<LanServerDraft> {
    const current = await this.dependencies.settings.read();
    const profile = current.servers.find((server) => server.id === serverId);
    if (!profile) throw new Error('LAN server not found');
    return {
      name: profile.name,
      urls: [...profile.urls],
      username: profile.username,
      password: (await this.dependencies.secrets.get(serverId)) ?? '',
      allowInsecureTls: profile.allowInsecureTls,
    };
  }

  async remove(serverId: string): Promise<void> {
    const current = await this.dependencies.settings.read();
    const existingIndex = current.servers.findIndex((server) => server.id === serverId);
    if (existingIndex < 0) throw new Error('LAN server not found');
    const previousPassword = await this.dependencies.secrets.get(serverId);
    const servers = current.servers.filter((server) => server.id !== serverId);
    await this.dependencies.secrets.delete(serverId);
    try {
      await this.dependencies.settings.write({ servers });
    } catch (error) {
      if (previousPassword !== null) {
        await this.dependencies.secrets.set(serverId, previousPassword).catch(() => undefined);
      }
      throw error;
    }
  }

  private profileFromDraft(id: string, draft: LanServerDraft): LanServerProfile {
    const urls = this.normalizeUrls(draft.urls);
    const username = draft.username.trim();
    if (urls.length === 0) throw new Error('At least one LAN server address is required');
    if (!username) throw new Error('LAN server username is required');
    if (!draft.password) throw new Error('LAN server password is required');

    return {
      id,
      name: draft.name.trim(),
      urls,
      username,
      allowInsecureTls: draft.allowInsecureTls,
    };
  }

  private normalizeUrls(values: string[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const raw = value.trim();
      if (!raw) continue;
      let parsed: URL;
      try {
        parsed = new URL(raw);
      } catch {
        throw new Error('LAN server address is invalid');
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('LAN server address must use HTTP or HTTPS');
      }
      if (parsed.username || parsed.password) {
        throw new Error('LAN server address cannot include credentials');
      }
      parsed.hash = '';
      const normalized = parsed.toString().replace(/\/$/, '');
      if (!seen.has(normalized)) {
        seen.add(normalized);
        result.push(normalized);
      }
    }
    return result;
  }
}

let sharedService: LanServerService | null = null;

export function configureLanServerService(
  dependencies: LanServerServiceDependencies
): LanServerService {
  if (sharedService) throw new Error('The LAN server service is already configured');
  sharedService = new LanServerService(dependencies);
  return sharedService;
}

export function getLanServerService(): LanServerService {
  if (!sharedService) throw new Error('The LAN server service is not configured');
  return sharedService;
}
