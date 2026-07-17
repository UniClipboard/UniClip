/// <reference types="jest" />

import { selectLocalizedReleaseNotes } from '../services/UpdateService';

const bilingualNotes = `## [zh-CN] 简体中文

### Android
- 中文通用
- 中文 Android

### iOS
- 中文 iOS

## [en] English

### Android
- English common
- English Android

### iOS
- English iOS
`;

describe('release note localization', () => {
  it.each([
    ['zh-CN', '### Android\n- 中文通用\n- 中文 Android\n\n### iOS\n- 中文 iOS'],
    ['en', '### Android\n- English common\n- English Android\n\n### iOS\n- English iOS'],
    ['en-US', '### Android\n- English common\n- English Android\n\n### iOS\n- English iOS'],
    ['ru', '### Android\n- English common\n- English Android\n\n### iOS\n- English iOS'],
    ['pt-BR', '### Android\n- English common\n- English Android\n\n### iOS\n- English iOS'],
  ])('selects the matching section for %s', (language, expected) => {
    expect(selectLocalizedReleaseNotes(bilingualNotes, language)).toBe(expected);
  });

  it.each([
    '## Android\n- 修复旧问题\n\n## iOS\n- 修复旧问题',
    'Release summary\n\n## English\n- This is an ordinary legacy section',
  ])('returns an unmarked legacy release body unchanged', (legacy) => {
    expect(selectLocalizedReleaseNotes(legacy, 'en')).toBe(legacy);
  });

  it('falls back to an available localized section', () => {
    const chineseOnly = '## [zh-CN] 简体中文\n\n### Android\n- 仅中文';

    expect(selectLocalizedReleaseNotes(chineseOnly, 'en')).toBe('### Android\n- 仅中文');
  });

  it('preserves an absent body as undefined', () => {
    expect(selectLocalizedReleaseNotes(undefined, 'en')).toBeUndefined();
  });
});
