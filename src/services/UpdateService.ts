/**
 * Update Service
 * 从 Cloudflare R2 派发的 manifest 检查版本更新
 */

import { runtimeStateStorage } from './RuntimeStateStorage';

// R2 更新网关。桌面端与移动端共用 bucket `uniclipboard-releases`,由 update-server
// Worker 暴露在 release.uniclipboard.app;移动端产物集中在 android/ 前缀下:
//   GET /android/{stable,beta}.json          → 渠道 manifest
//   GET /android/artifacts/{tag}/{file}.apk  → APK 下载
const R2_UPDATE_BASE = 'https://release.uniclipboard.app/android';
// GitHub / Gitee 仍作为下载镜像保留(R2 为主)。两者的 release 附件下载 URL 都采用
// /releases/download/<tag>/<file> 模式,由 manifest 里的 tagName + asset 名推导。
const RELEASES_PAGE_URL = 'https://github.com/UniClipboard/uc-android/releases';
const GITHUB_DOWNLOAD_BASE = 'https://github.com/UniClipboard/uc-android/releases/download';
// Gitee 仓库路径由 CI 的 GITEE_OWNER/GITEE_REPO 决定(uni-clipboard/uc-android),
// 与 GitHub 侧的 UniClipboard/uc-android 大小写/写法不同,勿直接沿用 GitHub 命名空间。
const GITEE_RELEASES_PAGE_URL = 'https://gitee.com/uni-clipboard/uc-android/releases';
const GITEE_DOWNLOAD_BASE = 'https://gitee.com/uni-clipboard/uc-android/releases/download';

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  build?: number;
  beta?: number;
}

export interface ReleaseAssetInfo {
  /** APK 文件名，如 UniClip-1.0.11-arm64-v8a.apk */
  name: string;
  /** R2 直接下载 URL（主下载源） */
  r2DownloadUrl: string;
  /** GitHub 直接下载 URL（镜像） */
  githubDownloadUrl: string;
  /** Gitee 直接下载 URL（镜像） */
  giteeDownloadUrl: string;
  /** SHA-256 哈希值（十六进制小写），来自 manifest 的 sha256 字段，可能为 undefined */
  sha256?: string;
}

export function versionToStr(v: ParsedVersion): string {
  let s = `${v.major}.${v.minor}.${v.patch}`;
  if (v.build !== undefined) s += `.${v.build}`;
  if (v.beta !== undefined) s += `-beta${v.beta}`;
  return s;
}

/**
 * 解析版本字符串，支持格式：
 *   v1.2.3, 1.2.3, v1.2.3.4, v1.2.3-beta1, 1.2.3.4-beta2
 */
export function parseVersion(versionStr: string): ParsedVersion | null {
  const match = versionStr.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?(?:-beta(\d+))?$/i);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    build: match[4] !== undefined ? parseInt(match[4], 10) : undefined,
    beta: match[5] !== undefined ? parseInt(match[5], 10) : undefined,
  };
}

/**
 * 比较两个版本，返回:
 *   正数 => a > b，负数 => a < b，0 => 相等
 * 规则与 AppVersion.cs 一致：正式版 > beta 版
 */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  const nums: (keyof ParsedVersion)[] = ['major', 'minor', 'patch'];
  for (const key of nums) {
    const av = (a[key] as number | undefined) ?? 0;
    const bv = (b[key] as number | undefined) ?? 0;
    if (av !== bv) return av - bv;
  }

  // build 段（第四位）
  const aBuild = a.build ?? -1;
  const bBuild = b.build ?? -1;
  if (aBuild !== bBuild) {
    // 有 build 段的字段数更多，视为更大
    if (a.build !== undefined && b.build === undefined) return 1;
    if (a.build === undefined && b.build !== undefined) return -1;
    return aBuild - bBuild;
  }

  // beta：正式版 (beta === undefined) > beta 版
  if (a.beta === undefined && b.beta === undefined) return 0;
  if (a.beta === undefined) return 1; // a 是正式版，更大
  if (b.beta === undefined) return -1; // b 是正式版，更大
  return a.beta - b.beta;
}

function getChangelogLanguage(language: string): 'zh' | 'en' {
  return language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  latestVersion: string;
  tagName: string;
  releaseUrl: string;
  giteeReleaseUrl: string;
  /** APK 资源列表（含各 ABI 的下载 URL 和哈希值） */
  assets: ReleaseAssetInfo[];
  /** 对应版本、平台和语言的静态 Markdown 更新说明 */
  releaseNotes?: string;
}

/**
 * R2 渠道 manifest 的线上格式。
 * 与 scripts/assemble-android-manifest.mjs 及 desktop 的 worker types.ts 保持一致。
 *
 * 注意两个版本串的差异：`version` 是 4 段式（= tag 去掉前缀 `v`，与安装包的
 * Android versionName 一致，供比较使用）；`assets[].name` 里的文件名用的是 3 段式
 * marketing 版本（expo.version），二者不能混用。详见 assemble 脚本的注释。
 */
interface AndroidUpdateManifest {
  version: string;
  tagName: string;
  prerelease: boolean;
  pub_date: string;
  notes: { en: string; zh: string };
  assets: Array<{ name: string; sha256?: string }>;
}

export interface AutomaticUpdateSettings {
  autoCheckUpdate: boolean;
  updateToBeta: boolean;
  debugUpdateCheckNoLimit: boolean;
  language: string;
}

export interface AutomaticUpdateDependencies {
  getToday: () => string;
  loadLastCheckDate: () => Promise<string>;
  recordCheckDate: (date: string) => Promise<void>;
  check: (
    currentVersion: string,
    includeBeta: boolean,
    language: string
  ) => Promise<UpdateCheckResult>;
}

/** 从 manifest 内嵌的双语 notes 中按当前界面语言取更新说明。 */
function pickManifestNotes(
  notes: AndroidUpdateManifest['notes'] | undefined,
  language: string
): string | undefined {
  if (!notes) return undefined;
  const body = notes[getChangelogLanguage(language)]?.trim();
  return body || undefined;
}

/**
 * 从 R2 渠道 manifest 获取最新版本并与当前版本比较
 * @param currentVersionStr 当前版本字符串（4 段式 Android versionName）
 * @param includeBeta 是否接受预发布版本（beta 渠道），默认 false
 * @param language 当前界面语言，用于从 manifest 选取对应语言的更新说明
 */
export async function checkForUpdate(
  currentVersionStr: string,
  includeBeta = false,
  language = 'en'
): Promise<UpdateCheckResult> {
  // includeBeta 只是「是否接受预发布」的布尔开关：stable 渠道只含最新正式版，
  // beta 渠道含（正式 + 预发布中）的最新版。
  const channel = includeBeta ? 'beta' : 'stable';
  const response = await fetch(`${R2_UPDATE_BASE}/${channel}.json`, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`R2 更新请求失败: ${response.status}`);
  }

  const manifest: AndroidUpdateManifest = await response.json();
  const tag = manifest.tagName;
  const githubReleaseUrl = `${RELEASES_PAGE_URL}/tag/${tag}`;
  const giteeReleaseUrl = `${GITEE_RELEASES_PAGE_URL}/tag/${tag}`;

  // R2 为主下载源；GitHub / Gitee 按同一套 /releases/download/<tag>/<file> 规则推导为镜像。
  const apkAssets: ReleaseAssetInfo[] = (manifest.assets ?? [])
    .filter((a) => a.name.endsWith('.apk'))
    .map((a) => ({
      name: a.name,
      r2DownloadUrl: `${R2_UPDATE_BASE}/artifacts/${tag}/${a.name}`,
      githubDownloadUrl: `${GITHUB_DOWNLOAD_BASE}/${tag}/${a.name}`,
      giteeDownloadUrl: `${GITEE_DOWNLOAD_BASE}/${tag}/${a.name}`,
      sha256: a.sha256?.toLowerCase(),
    }));

  const latestParsed = parseVersion(manifest.version);
  const currentParsed = parseVersion(currentVersionStr);

  if (!currentParsed || !latestParsed) {
    return {
      hasUpdate: false,
      latestVersion: manifest.version,
      tagName: tag,
      releaseUrl: githubReleaseUrl,
      giteeReleaseUrl,
      assets: apkAssets,
      releaseNotes: undefined,
    };
  }

  const hasUpdate = compareVersions(latestParsed, currentParsed) > 0;
  const releaseNotes = hasUpdate ? pickManifestNotes(manifest.notes, language) : undefined;
  return {
    hasUpdate,
    latestVersion: versionToStr(latestParsed),
    tagName: tag,
    releaseUrl: githubReleaseUrl,
    giteeReleaseUrl,
    assets: apkAssets,
    releaseNotes,
  };
}

const automaticUpdateDependencies: AutomaticUpdateDependencies = {
  getToday: () => new Date().toISOString().slice(0, 10),
  loadLastCheckDate: async () => (await runtimeStateStorage.load()).lastUpdateCheckDate,
  recordCheckDate: (date) => runtimeStateStorage.update({ lastUpdateCheckDate: date }),
  check: checkForUpdate,
};

/** Run a silent, frequency-limited update check from any eligible screen. */
export async function checkForAutomaticUpdate(
  currentVersion: string,
  settings: AutomaticUpdateSettings,
  dependencies: AutomaticUpdateDependencies = automaticUpdateDependencies
): Promise<UpdateCheckResult | null> {
  if (!settings.autoCheckUpdate) return null;

  const today = dependencies.getToday();
  const lastCheckDate = await dependencies.loadLastCheckDate();
  if (!settings.debugUpdateCheckNoLimit && lastCheckDate === today) return null;

  await dependencies.recordCheckDate(today);
  return dependencies.check(currentVersion, settings.updateToBeta, settings.language);
}
