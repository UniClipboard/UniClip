/// <reference types="jest" />

import { checkForUpdate, fetchChangelog, getChangelogUrl } from '../services/UpdateService';

const release = {
  tag_name: 'v1.4.0.200',
  prerelease: false,
  draft: false,
  html_url: 'https://github.com/UniClipboard/UniClip/releases/tag/v1.4.0.200',
  body: 'This Release body must not be used by the app.',
  assets: [],
};

function jsonResponse(value: unknown): Response {
  return {
    ok: true,
    json: async () => value,
  } as Response;
}

function textResponse(value: string, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 404,
    text: async () => value,
  } as Response;
}

describe('versioned changelog fetching', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ['zh-CN', 'v1.4.0.200.android.zh.md'],
    ['zh-Hans', 'v1.4.0.200.android.zh.md'],
    ['en', 'v1.4.0.200.android.en.md'],
    ['ru', 'v1.4.0.200.android.en.md'],
    ['pt-BR', 'v1.4.0.200.android.en.md'],
  ])('builds an immutable Android changelog URL for %s', (language, filename) => {
    expect(getChangelogUrl('v1.4.0.200', 'android', language)).toBe(
      `https://raw.githubusercontent.com/UniClipboard/UniClip/v1.4.0.200/changelogs/${filename}`
    );
  });

  it('fetches a platform and language specific Markdown file', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(textResponse('- 中文更新'));

    await expect(fetchChangelog('v1.4.0.200', 'android', 'zh-CN')).resolves.toBe('- 中文更新');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/UniClipboard/UniClip/v1.4.0.200/changelogs/v1.4.0.200.android.zh.md'
    );
  });

  it('uses the versioned file instead of the GitHub Release body', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse([release]))
      .mockResolvedValueOnce(textResponse('- Android 中文日志'));

    const result = await checkForUpdate('1.3.0.163', false, 'zh-CN');

    expect(result.hasUpdate).toBe(true);
    expect(result.releaseNotes).toBe('- Android 中文日志');
    expect(result.releaseNotes).not.toBe(release.body);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('keeps an available update usable when its changelog file is missing', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse([release]))
      .mockResolvedValueOnce(textResponse('', false));

    const result = await checkForUpdate('1.3.0.163', false, 'en');

    expect(result.hasUpdate).toBe(true);
    expect(result.releaseNotes).toBeUndefined();
  });
});
