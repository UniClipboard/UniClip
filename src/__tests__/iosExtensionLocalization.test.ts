import fs from 'node:fs';
import path from 'node:path';

const locales = ['zh-Hans', 'en', 'ru', 'pt-BR'] as const;
const extensionTargets = ['share', 'keyboard'] as const;
const swiftSources = {
  share: ['ShareRootView.swift', 'ShareItem.swift'],
  keyboard: ['KeyboardRootView.swift', 'KeyboardModel.swift', 'KeyboardModel+Localization.swift'],
} as const;

function parseStringsFile(filePath: string): Map<string, string> {
  const source = fs.readFileSync(filePath, 'utf8');
  const entries = new Map<string, string>();
  const linePattern = /^"((?:\\.|[^"\\])*)"\s*=\s*"((?:\\.|[^"\\])*)";$/gm;

  for (const match of source.matchAll(linePattern)) {
    let key: string;
    let value: string;
    try {
      key = JSON.parse(`"${match[1]}"`) as string;
      value = JSON.parse(`"${match[2]}"`) as string;
    } catch (error) {
      throw new Error(`Invalid strings entry in ${filePath}: ${String(error)}`);
    }
    if (entries.has(key)) throw new Error(`Duplicate localization key ${key} in ${filePath}`);
    entries.set(key, value);
  }

  const contentLines = source.split('\n').filter((line) => line.trim().length > 0);
  expect(entries.size).toBe(contentLines.length);
  return entries;
}

function placeholders(value: string): string[] {
  return value.match(/%(?:\d+\$)?(?:@|lld)/g)?.map((token) => token.replace(/^%\d+\$/, '%')) ?? [];
}

describe('iOS extension localization resources', () => {
  it.each(extensionTargets)('%s ships the same complete key set in every locale', (target) => {
    const resources = new Map(
      locales.map((locale) => {
        const filePath = path.join(
          process.cwd(),
          'targets',
          target,
          `${locale}.lproj`,
          'Localizable.strings'
        );
        return [locale, parseStringsFile(filePath)] as const;
      })
    );

    const source = resources.get('zh-Hans');
    if (!source) throw new Error(`Missing zh-Hans resources for ${target}`);
    expect(source.size).toBeGreaterThan(20);

    for (const locale of locales) {
      const localized = resources.get(locale);
      if (!localized) throw new Error(`Missing ${locale} resources for ${target}`);
      const compareStrings = (left: string, right: string): number => left.localeCompare(right);
      expect([...localized.keys()].sort(compareStrings)).toEqual(
        [...source.keys()].sort(compareStrings)
      );
      for (const [key, sourceValue] of source) {
        const localizedValue = localized.get(key);
        if (!localizedValue) throw new Error(`Missing ${locale} value for ${target}:${key}`);
        expect(placeholders(localizedValue)).toEqual(placeholders(sourceValue));
      }
    }
  });

  it.each(extensionTargets)('%s covers Swift call sites and has real translations', (target) => {
    const targetDirectory = path.join(process.cwd(), 'targets', target);
    const sourceCode = swiftSources[target]
      .map((fileName) => fs.readFileSync(path.join(targetDirectory, fileName), 'utf8'))
      .join('\n');
    const sourceStrings = parseStringsFile(
      path.join(targetDirectory, 'zh-Hans.lproj', 'Localizable.strings')
    );

    const referencedKeys = new Set<string>();
    const localizationCall = /localization\.string\(\s*"([^"]+)"/g;
    for (const match of sourceCode.matchAll(localizationCall)) referencedKeys.add(match[1]);
    if (target === 'keyboard') {
      for (const key of ['全部', '文本', '链接', '图片', '同步成功', '已复制', '已插入']) {
        referencedKeys.add(key);
      }
    }

    expect(referencedKeys.size).toBeGreaterThan(15);
    for (const key of referencedKeys) expect(sourceStrings.has(key)).toBe(true);
    expect(sourceCode).not.toMatch(
      /(?:Text|Button|Label|navigationTitle)\(\s*"[^"]*[\u3400-\u9fff]/
    );

    for (const locale of locales.filter((value) => value !== 'zh-Hans')) {
      const localized = parseStringsFile(
        path.join(targetDirectory, `${locale}.lproj`, 'Localizable.strings')
      );
      for (const [key, sourceValue] of sourceStrings) {
        expect(localized.get(key)).not.toBe(sourceValue);
      }
    }
  });
});
