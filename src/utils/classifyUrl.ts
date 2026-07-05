import i18n from '@/i18n';

export type ServerURLClass = 'lan' | 'tailscale' | 'wan';

export const URL_CLASS_ICONS = {
  lan: 'house.fill',
  tailscale: 'point.3.connected.trianglepath.dotted',
  wan: 'globe',
} as const;

/** Android 对应图标(Ionicons 名),与 iOS 的 SF Symbols 语义一一对应。 */
export const URL_CLASS_IONICONS = {
  lan: 'home',
  tailscale: 'git-network',
  wan: 'globe-outline',
} as const;

// 图标名(SF Symbol / Ionicon)不随语言变化;label 的翻译键在调用时经 i18n.t 解析,
// 保证切换语言即时生效(不能把已翻译文案固化到模块级常量)。
const URL_CLASS_ICON: Record<ServerURLClass, string> = {
  lan: URL_CLASS_ICONS.lan,
  tailscale: URL_CLASS_ICONS.tailscale,
  wan: URL_CLASS_ICONS.wan,
};

const URL_CLASS_LABEL_KEY: Record<ServerURLClass, string> = {
  lan: 'errors:urlClass.lan',
  tailscale: 'errors:urlClass.tailscale',
  wan: 'errors:urlClass.wan',
};

export const URL_CLASS_DISPLAY_ORDER: ServerURLClass[] = ['lan', 'tailscale', 'wan'];

export function getURLClassDisplay(cls: ServerURLClass): { label: string; icon: string } {
  return { label: i18n.t(URL_CLASS_LABEL_KEY[cls]), icon: URL_CLASS_ICON[cls] };
}

function classifyIPv4(host: string): ServerURLClass | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    const v = parseInt(part, 10);
    if (isNaN(v) || v < 0 || v > 255 || String(v) !== part) return null;
    octets.push(v);
  }
  const [a, b] = octets;
  if (a === 100 && b >= 64 && b <= 127) return 'tailscale';
  if (a === 10) return 'lan';
  if (a === 172 && b >= 16 && b <= 31) return 'lan';
  if (a === 192 && b === 168) return 'lan';
  if (a === 169 && b === 254) return 'lan';
  return 'wan';
}

export function classifyURL(urlString: string): ServerURLClass {
  try {
    const host = new URL(urlString.trim()).hostname.toLowerCase();
    if (!host) return 'wan';
    if (host.endsWith('.ts.net')) return 'tailscale';
    if (host.endsWith('.local')) return 'lan';
    return classifyIPv4(host) ?? 'wan';
  } catch {
    return 'wan';
  }
}

export function effectiveURLs(urls: string[] | undefined, url: string): string[] {
  if (urls && urls.length > 0) return urls;
  return [url];
}
