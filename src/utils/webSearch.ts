import { Linking } from 'react-native';

/**
 * 用系统默认搜索应用搜索一段文字。Android 走 ACTION_WEB_SEARCH（尊重用户的默认搜索应用）；
 * sendIntent 不可用（iOS）或没有应用响应时，回落到浏览器打开搜索页。
 */
export async function openWebSearch(query: string): Promise<void> {
  const q = query.trim();
  if (!q) return;
  try {
    await Linking.sendIntent('android.intent.action.WEB_SEARCH', [{ key: 'query', value: q }]);
  } catch {
    await Linking.openURL(`https://www.google.com/search?q=${encodeURIComponent(q)}`);
  }
}
