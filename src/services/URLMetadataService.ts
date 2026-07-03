import { Image } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { sha256 } from 'js-sha256';

export interface URLCardMetadata {
  title?: string;
  ogImageUrl?: string;
  faviconUrl?: string;
}

// 磁盘缓存与原生 Swift app 的 URLMetadataCache 共用同一套布局：
// Caches/URLMetadata/<SHA256(url) 前 16 字节 hex>.json + <hash>.jpg（OG 图字节）。
// bundle id 统一后两端可互相命中，不要改动目录名、hash 规则或 json/jpg 命名。
const DISK_DIR = new Directory(Paths.cache, 'URLMetadata');

// 与原生 DiskEntry 对齐：title/hasImage 两端共用；faviconUrl/ogImageUrl 是 RN 端
// 扩展字段（原生 JSONDecoder 忽略未知字段），ogImageUrl 存远程原地址，
// 供图片字节下载失败（hasImage=false）时兜底显示
interface DiskEntry {
  title?: string;
  hasImage: boolean;
  faviconUrl?: string;
  ogImageUrl?: string;
}

const memoryCache = new Map<string, URLCardMetadata>();
const inFlight = new Set<string>();

export async function fetchURLMetadata(url: string): Promise<URLCardMetadata> {
  if (memoryCache.has(url)) return memoryCache.get(url)!;
  if (inFlight.has(url)) return {};

  inFlight.add(url);
  try {
    const disk = await loadDisk(url);
    if (disk) {
      memoryCache.set(url, disk);
      return disk;
    }

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

    // 跳转后以最终地址为 base 解析相对路径
    const baseUrl = resp.url || url;

    const contentType = resp.headers.get('content-type') ?? '';
    const meta =
      !resp.ok || !contentType.includes('text/html')
        ? faviconOnlyMeta(baseUrl)
        : parseOGMeta(await resp.text(), baseUrl);

    // 只固化有信息量的结果；空壳（站点临时 403/challenge、404）只留内存，冷启动可重试
    const cached = meta.title || meta.ogImageUrl ? await saveDisk(url, meta) : meta;

    if (cached.faviconUrl) {
      Image.prefetch(cached.faviconUrl).catch(() => {});
    }

    memoryCache.set(url, cached);
    return cached;
  } catch {
    // 断网/超时是暂时的：只写内存（本次会话不重试），不写盘，冷启动后可重试
    const fallback = faviconOnlyMeta(url);
    memoryCache.set(url, fallback);
    return fallback;
  } finally {
    inFlight.delete(url);
  }
}

function diskHash(url: string): string {
  // SHA256 前 16 字节 hex，与原生 diskHash 一致
  return sha256(url).slice(0, 32);
}

async function loadDisk(url: string): Promise<URLCardMetadata | null> {
  try {
    const h = diskHash(url);
    const metaFile = new File(DISK_DIR, `${h}.json`);
    if (!metaFile.exists) return null;
    const entry: DiskEntry = JSON.parse(await metaFile.text());

    const meta: URLCardMetadata = { title: entry.title };
    // 原生写入的条目没有 faviconUrl 字段，补站点根目录兜底
    meta.faviconUrl = entry.faviconUrl ?? defaultFavicon(url);
    if (entry.hasImage) {
      const imgFile = new File(DISK_DIR, `${h}.jpg`);
      if (imgFile.exists) meta.ogImageUrl = imgFile.uri;
    } else if (entry.ogImageUrl) {
      meta.ogImageUrl = entry.ogImageUrl;
    }
    return meta;
  } catch {
    return null;
  }
}

/** 把 OG 图字节落盘并写入 JSON 条目；返回 ogImageUrl 替换为本地 URI 后的元数据 */
async function saveDisk(url: string, meta: URLCardMetadata): Promise<URLCardMetadata> {
  const result: URLCardMetadata = { ...meta };
  try {
    if (!DISK_DIR.exists) DISK_DIR.create();
    const h = diskHash(url);

    let hasImage = false;
    if (meta.ogImageUrl) {
      // 扩展名固定 .jpg 以对齐原生布局；实际字节可能是 PNG/WebP，
      // RN Image 与原生 UIImage 都按内容解码，不看扩展名
      const imgFile = new File(DISK_DIR, `${h}.jpg`);
      try {
        if (imgFile.exists) imgFile.delete();
        await File.downloadFileAsync(meta.ogImageUrl, imgFile, { headers: {} });
        hasImage = imgFile.exists && imgFile.size > 0;
        if (hasImage) result.ogImageUrl = imgFile.uri;
      } catch {
        // 图片下载失败：内存与 JSON 保留远程地址，hasImage=false，下次冷启动兜底显示远程图
      }
    }

    const entry: DiskEntry = {
      title: meta.title,
      hasImage,
      faviconUrl: meta.faviconUrl,
      ogImageUrl: meta.ogImageUrl,
    };
    new File(DISK_DIR, `${h}.json`).write(JSON.stringify(entry));
  } catch {
    // 磁盘不可用时退化为纯内存缓存
  }
  return result;
}

function parseOGMeta(html: string, baseUrl: string): URLCardMetadata {
  // GitHub 等站点 <head> 超过 16KB，og:title 靠后；64KB 窗口兼顾命中率和正则开销
  const head = html.slice(0, 65536);
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

  // apple-touch-icon 通常是 ≥120px 的 PNG，放大展示质量最好
  const iconMatch =
    matchLinkHref(head, 'apple-touch-icon(?:-precomposed)?') ??
    matchLinkHref(head, '(?:shortcut\\s+)?icon');
  result.faviconUrl = iconMatch ? resolveUrl(iconMatch, baseUrl) : defaultFavicon(baseUrl);

  return result;
}

/** 页面不是 HTML（PDF、图片、下载直链…）或请求失败时，仍尝试站点根目录 favicon */
function faviconOnlyMeta(url: string): URLCardMetadata {
  const favicon = defaultFavicon(url);
  return favicon ? { faviconUrl: favicon } : {};
}

function defaultFavicon(url: string): string | undefined {
  try {
    return new URL(url).origin + '/favicon.ico';
  } catch {
    return undefined;
  }
}

function matchLinkHref(html: string, relPattern: string): string | null {
  const patterns = [
    new RegExp(`<link[^>]+rel=["']${relPattern}["'][^>]*href=["']([^"']+)["']`, 'i'),
    new RegExp(`<link[^>]+href=["']([^"']+)["'][^>]*rel=["']${relPattern}["']`, 'i'),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
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
