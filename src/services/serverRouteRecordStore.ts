import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLiveUrl as getAppGroupLiveUrl, saveLiveUrl as saveAppGroupLiveUrl } from 'app-group-store';

const LIVE_URL_KEY_PREFIX = '@server-route:live-url:';

export async function loadServerRouteLiveUrl(serverKey: string): Promise<string | null> {
  const key = makeLiveUrlKey(serverKey);
  const local = await AsyncStorage.getItem(key);
  if (local !== null) return local || null;

  const appGroupUrl = await readAppGroupLiveUrl(serverKey);
  if (appGroupUrl) {
    await AsyncStorage.setItem(key, appGroupUrl);
  }
  return appGroupUrl;
}

export async function saveServerRouteLiveUrl(
  serverKey: string,
  url: string | null
): Promise<void> {
  const key = makeLiveUrlKey(serverKey);
  if (url) {
    await AsyncStorage.setItem(key, url);
  } else {
    await AsyncStorage.removeItem(key);
  }
  await writeAppGroupLiveUrl(serverKey, url);
}

function makeLiveUrlKey(serverKey: string): string {
  return `${LIVE_URL_KEY_PREFIX}${encodeURIComponent(serverKey)}`;
}

async function readAppGroupLiveUrl(serverKey: string): Promise<string | null> {
  try {
    return await getAppGroupLiveUrl(serverKey);
  } catch {
    return null;
  }
}

async function writeAppGroupLiveUrl(serverKey: string, url: string | null): Promise<void> {
  try {
    await saveAppGroupLiveUrl(serverKey, url);
  } catch {
    // App Group storage is only required for iOS extensions; main-app routing has AsyncStorage.
  }
}
