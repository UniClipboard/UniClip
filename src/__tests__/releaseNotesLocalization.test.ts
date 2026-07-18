/// <reference types="jest" />

import { getChangelogUrl } from '../services/UpdateService';

describe('changelog file localization', () => {
  it.each([
    ['zh-CN', 'zh'],
    ['zh-Hans', 'zh'],
    ['en', 'en'],
    ['en-US', 'en'],
    ['ru', 'en'],
    ['pt-BR', 'en'],
  ])('maps %s to the %s changelog file', (language, expectedLanguage) => {
    expect(
      getChangelogUrl('v1.3.0.163', 'ios', language).endsWith(
        `/changelogs/v1.3.0.163.ios.${expectedLanguage}.md`
      )
    ).toBe(true);
  });
});
