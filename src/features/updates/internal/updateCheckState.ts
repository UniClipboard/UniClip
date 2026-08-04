import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_UPDATE_CHECK_DATE_KEY = '@syncclipboard:updates:last-check-date';

export async function loadLastUpdateCheckDate(): Promise<string> {
  return (await AsyncStorage.getItem(LAST_UPDATE_CHECK_DATE_KEY)) ?? '';
}

export async function recordUpdateCheckDate(date: string): Promise<void> {
  await AsyncStorage.setItem(LAST_UPDATE_CHECK_DATE_KEY, date);
}
