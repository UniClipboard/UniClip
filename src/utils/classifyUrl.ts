export type ServerURLClass = 'lan' | 'tailscale' | 'wan';

export const URL_CLASS_ICONS = {
  lan: 'house.fill',
  tailscale: 'point.3.connected.trianglepath.dotted',
  wan: 'globe',
} as const;

const URL_CLASS_DISPLAY: Record<ServerURLClass, { label: string; icon: string }> = {
  lan: { label: '局域网', icon: URL_CLASS_ICONS.lan },
  tailscale: { label: 'Tailscale', icon: URL_CLASS_ICONS.tailscale },
  wan: { label: '公网', icon: URL_CLASS_ICONS.wan },
};

export const URL_CLASS_DISPLAY_ORDER: ServerURLClass[] = ['lan', 'tailscale', 'wan'];

export function getURLClassDisplay(cls: ServerURLClass) {
  return URL_CLASS_DISPLAY[cls];
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
