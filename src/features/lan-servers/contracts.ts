import type { LanServerProfile } from '@/types/lan';

export type { LanServerProfile } from '@/types/lan';

export interface LanServerDraft {
  name: string;
  urls: string[];
  username: string;
  password: string;
  allowInsecureTls: boolean;
}

export interface LanServerSettingsSnapshot {
  servers: LanServerProfile[];
  syncChannel?: 'lan';
}

export interface LanServerSettingsPort {
  read(): Promise<LanServerSettingsSnapshot>;
  write(snapshot: LanServerSettingsSnapshot): Promise<void>;
}

export interface LanServerSecretPort {
  get(serverId: string): Promise<string | null>;
  set(serverId: string, password: string): Promise<void>;
  delete(serverId: string): Promise<void>;
}
