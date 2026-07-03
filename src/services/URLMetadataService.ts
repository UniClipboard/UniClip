import { Image } from 'react-native';

export interface URLCardMetadata {
  title?: string;
  ogImageUrl?: string;
}

const memoryCache = new Map<string, URLCardMetadata>();
const inFlight = new Set<string>();

export async function fetchURLMetadata(url: string): Promise<URLCardMetadata> {
  if (memoryCache.has(url)) return memoryCache.get(url)!;
  if (inFlight.has(url)) return {};

  inFlight.add(url);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; UniClipboard/1.0; +https://github.com/user/uniclipboard)',
      },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      const empty: URLCardMetadata = {};
      memoryCache.set(url, empty);
      return empty;
    }

    const contentType = resp.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) {
      const empty: URLCardMetadata = {};
      memoryCache.set(url, empty);
      return empty;
    }

    const html = await resp.text();
    const meta = parseOGMeta(html, url);

    if (meta.ogImageUrl) {
      Image.prefetch(meta.ogImageUrl).catch(() => {});
    }

    memoryCache.set(url, meta);
    return meta;
  } catch {
    const empty: URLCardMetadata = {};
    memoryCache.set(url, empty);
    return empty;
  } finally {
    inFlight.delete(url);
  }
}

function parseOGMeta(html: string, baseUrl: string): URLCardMetadata {
  const head = html.slice(0, 16384);
  const result: URLCardMetadata = {};

  const titleMatch = matchMetaContent(head, 'og:title') ?? matchMetaContent(head, 'twitter:title');
  if (titleMatch) {
    result.title = decodeHTMLEntities(titleMatch);
  } else {
    const tagMatch = head.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (tagMatch?.[1]) {
      result.title = decodeHTMLEntities(tagMatch[1].trim());
    }
  }

  const imageMatch =
    matchMetaContent(head, 'og:image') ??
    matchMetaContent(head, 'twitter:image') ??
    matchMetaContent(head, 'twitter:image:src');
  if (imageMatch) {
    result.ogImageUrl = resolveUrl(imageMatch, baseUrl);
  }

  return result;
}

function matchMetaContent(html: string, property: string): string | null {
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${escapeRegex(property)}["'][^>]+content=["']([^"']+)["']`,
      'i'
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escapeRegex(property)}["']`,
      'i'
    ),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveUrl(maybeRelative: string, base: string): string {
  if (maybeRelative.startsWith('http://') || maybeRelative.startsWith('https://')) {
    return maybeRelative;
  }
  if (maybeRelative.startsWith('//')) {
    const protocol = base.startsWith('https') ? 'https:' : 'http:';
    return protocol + maybeRelative;
  }
  try {
    return new URL(maybeRelative, base).href;
  } catch {
    return maybeRelative;
  }
}

function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}
