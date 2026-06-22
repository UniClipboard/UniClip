import { requireNativeModule } from 'expo-modules-core';

const NativeModule = requireNativeModule('UcCore');

// --- Types ---

export interface ServerConfig {
  baseUrl: string;
  username: string;
  password: string;
}

export interface ClipboardMeta {
  kind: 'Text' | 'Image' | 'File' | 'Group';
  text: string;
  dataName: string | null;
  hasData: boolean;
  size: number;
  hash: string | null;
}

export interface ConnectPayload {
  v: number;
  url: string;
  urls: string[];
  user: string;
  pwd: string;
  other: Record<string, string>;
}

export interface HistoryQuery {
  page?: number;
  beforeMs?: number;
  afterMs?: number;
  modifiedAfterMs?: number;
  types?: number;
  searchText?: string;
  starred?: boolean;
  sortByLastAccessed?: boolean;
}

export interface HistoryRecord {
  hash: string;
  kind: 'Text' | 'Image' | 'File' | 'Group';
  text: string | null;
  hasData: boolean;
  size: number | null;
  createTimeMs: number | null;
  lastModifiedMs: number | null;
  lastAccessedMs: number | null;
  starred: boolean;
  pinned: boolean;
  version: number | null;
  isDeleted: boolean;
}

export type ProbeResult = 'Success' | 'AuthFailed' | 'Unreachable' | 'MissingFields';

export interface ProbeReport {
  networkEpoch: number;
  results: Record<string, ProbeResult>;
}

// --- Functions ---

export function parseConnectUri(uri: string): ConnectPayload {
  return NativeModule.parseConnectUri(uri);
}

export async function getLatest(
  server: ServerConfig,
  trustInsecureCert = false
): Promise<ClipboardMeta> {
  return NativeModule.getLatest(server, trustInsecureCert);
}

export async function putClipboard(
  server: ServerConfig,
  meta: ClipboardMeta,
  payload?: ArrayBuffer,
  trustInsecureCert = false
): Promise<void> {
  return NativeModule.putClipboard(server, meta, payload ?? null, trustInsecureCert);
}

export async function testConnection(
  server: ServerConfig,
  trustInsecureCert = false
): Promise<ProbeResult> {
  return NativeModule.testConnection(server, trustInsecureCert);
}

export async function queryHistory(
  server: ServerConfig,
  query: HistoryQuery,
  trustInsecureCert = false
): Promise<HistoryRecord[]> {
  return NativeModule.queryHistory(server, query, trustInsecureCert);
}

export async function getFile(
  server: ServerConfig,
  name: string,
  trustInsecureCert = false
): Promise<ArrayBuffer> {
  return NativeModule.getFile(server, name, trustInsecureCert);
}

export async function putFile(
  server: ServerConfig,
  name: string,
  body: ArrayBuffer,
  trustInsecureCert = false
): Promise<void> {
  return NativeModule.putFile(server, name, body, trustInsecureCert);
}

export async function getHistoryPayload(
  server: ServerConfig,
  profileId: string,
  trustInsecureCert = false
): Promise<ArrayBuffer> {
  return NativeModule.getHistoryPayload(server, profileId, trustInsecureCert);
}

export async function probe(
  urls: string[],
  username: string,
  password: string,
  trustInsecureCert = false,
  timeoutMs = 3000,
  networkEpoch = 0
): Promise<ProbeReport> {
  return NativeModule.probe(
    urls,
    username,
    password,
    trustInsecureCert,
    timeoutMs,
    networkEpoch
  );
}

export function cancelInFlight(): void {
  NativeModule.cancelInFlight();
}
