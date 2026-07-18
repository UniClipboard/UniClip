/// <reference types="jest" />

import { checkForUpdate } from '../services/UpdateService';

const R2_BASE = 'https://release.uniclipboard.app/android';

const manifest = {
  version: '1.4.0.200',
  tagName: 'v1.4.0.200',
  prerelease: false,
  pub_date: '2026-07-18T10:00:00.000Z',
  notes: { en: '- English update', zh: '- 中文更新' },
  // The APK filenames use the 3-segment marketing version, distinct from the
  // 4-segment compared `version` above — see assemble-android-manifest.mjs.
  assets: [
    { name: 'UniClip-1.4.0-arm64-v8a.apk', sha256: 'AABBCC' },
    { name: 'UniClip-1.4.0-universal.apk', sha256: 'DDEEFF' },
  ],
};

function jsonResponse(value: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status: ok ? status : status === 200 ? 500 : status,
    json: async () => value,
  } as Response;
}

describe('checkForUpdate via R2 manifest', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches the stable channel manifest by default', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(manifest));

    await checkForUpdate('1.3.0.163', false, 'en');

    expect(fetchSpy).toHaveBeenCalledWith(`${R2_BASE}/stable.json`, expect.anything());
  });

  it('fetches the beta channel manifest when beta updates are enabled', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(manifest));

    await checkForUpdate('1.3.0.163', true, 'en');

    expect(fetchSpy).toHaveBeenCalledWith(`${R2_BASE}/beta.json`, expect.anything());
  });

  it('derives R2, GitHub and Gitee download URLs from the tag and filename', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(manifest));

    const result = await checkForUpdate('1.3.0.163', false, 'en');

    expect(result.assets).toHaveLength(2);
    const [arm] = result.assets;
    expect(arm.name).toBe('UniClip-1.4.0-arm64-v8a.apk');
    expect(arm.r2DownloadUrl).toBe(`${R2_BASE}/artifacts/v1.4.0.200/UniClip-1.4.0-arm64-v8a.apk`);
    expect(arm.githubDownloadUrl).toBe(
      'https://github.com/UniClipboard/uc-android/releases/download/v1.4.0.200/UniClip-1.4.0-arm64-v8a.apk'
    );
    expect(arm.giteeDownloadUrl).toBe(
      'https://gitee.com/uni-clipboard/uc-android/releases/download/v1.4.0.200/UniClip-1.4.0-arm64-v8a.apk'
    );
    // sha256 is normalized to lowercase for the on-device hash comparison.
    expect(arm.sha256).toBe('aabbcc');
  });

  it('reports an update and picks the language-matched notes from the manifest', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(manifest));

    const zh = await checkForUpdate('1.3.0.163', false, 'zh-CN');
    expect(zh.hasUpdate).toBe(true);
    expect(zh.latestVersion).toBe('1.4.0.200');
    expect(zh.releaseNotes).toBe('- 中文更新');

    const en = await checkForUpdate('1.3.0.163', false, 'en');
    expect(en.releaseNotes).toBe('- English update');
  });

  it.each([
    ['zh-CN', '- 中文更新'],
    ['zh-Hans', '- 中文更新'],
    ['en', '- English update'],
    ['en-US', '- English update'],
    ['ru', '- English update'],
    ['pt-BR', '- English update'],
  ])('maps %s to the matching manifest notes', async (language, expectedNotes) => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(manifest));

    const result = await checkForUpdate('1.3.0.163', false, language);

    expect(result.releaseNotes).toBe(expectedNotes);
  });

  it('reports no update when already on the latest build', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(manifest));

    const result = await checkForUpdate('1.4.0.200', false, 'en');

    expect(result.hasUpdate).toBe(false);
    expect(result.releaseNotes).toBeUndefined();
  });

  it('omits release notes when the manifest has none for the language', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ ...manifest, notes: { en: '', zh: '' } }));

    const result = await checkForUpdate('1.3.0.163', false, 'en');

    expect(result.hasUpdate).toBe(true);
    expect(result.releaseNotes).toBeUndefined();
  });

  it('throws when the manifest request fails', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({}, false, 404));

    await expect(checkForUpdate('1.3.0.163', false, 'en')).rejects.toThrow('R2');
  });
});
