/// <reference types="jest" />

jest.mock('expo-localization', () => ({ getLocales: jest.fn() }));

import { getLocales } from 'expo-localization';
import { createInstance } from 'i18next';
import { resolveDeviceLanguage, resolvePreference } from '../i18n/languages';
import type { AppLanguage } from '../i18n/languages';

const mockGetLocales = jest.mocked(getLocales);
import { NS_LIST, resources } from '../i18n/resources';

interface TranslationTree {
  [key: string]: string | TranslationTree;
}

function leafValues(tree: TranslationTree, path = ''): Map<string, string> {
  const leaves = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (typeof value === 'string') leaves.set(nextPath, value);
    else
      for (const [childPath, childValue] of leafValues(value, nextPath))
        leaves.set(childPath, childValue);
  }
  return leaves;
}

function normalizePluralSuffix(path: string): string {
  return path.replace(/_(zero|one|two|few|many|other)$/, '');
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function normalizedLeafKeys(leaves: Map<string, string>): string[] {
  return [...new Set([...leaves.keys()].map(normalizePluralSuffix))].sort(compareStrings);
}

function interpolationVariables(value: string): string[] {
  return [...value.matchAll(/{{\s*([^},\s]+)[^}]*}}/g)]
    .map((match) => match[1])
    .sort(compareStrings);
}

function setDeviceLanguage(languageCode: string): void {
  mockGetLocales.mockReturnValue([{ languageCode }] as unknown as ReturnType<typeof getLocales>);
}

describe('i18n resources', () => {
  it('registers every namespace for all supported languages', () => {
    expect(Object.keys(resources).sort(compareStrings)).toEqual(['en', 'pt-BR', 'ru', 'zh-CN']);
    for (const language of Object.keys(resources) as AppLanguage[]) {
      expect(Object.keys(resources[language]).sort(compareStrings)).toEqual(
        [...NS_LIST].sort(compareStrings)
      );
    }
  });

  it('matches English leaf keys and interpolation variables after v4 plural normalization', () => {
    const englishNamespaces = resources.en as Record<string, TranslationTree>;
    for (const language of ['zh-CN', 'ru', 'pt-BR'] as const) {
      const localizedNamespaces = resources[language] as Record<string, TranslationTree>;
      for (const namespace of NS_LIST) {
        const englishLeaves = leafValues(englishNamespaces[namespace]);
        const localizedLeaves = leafValues(localizedNamespaces[namespace]);
        expect(normalizedLeafKeys(localizedLeaves)).toEqual(normalizedLeafKeys(englishLeaves));

        for (const [path, englishValue] of englishLeaves) {
          const normalizedPath = normalizePluralSuffix(path);
          const localizedValues = [...localizedLeaves].flatMap(([localizedPath, value]) =>
            normalizePluralSuffix(localizedPath) === normalizedPath ? [value] : []
          );
          expect(localizedValues).not.toHaveLength(0);
          for (const localizedValue of localizedValues) {
            expect(interpolationVariables(localizedValue)).toEqual(
              interpolationVariables(englishValue)
            );
          }
        }
      }
    }
  });

  it('uses Brazilian Portuguese singular and plural forms at runtime', async () => {
    const instance = createInstance();
    await instance.init({
      lng: 'pt-BR',
      resources: { 'pt-BR': { settings: resources['pt-BR'].settings } },
      defaultNS: 'settings',
    });

    expect(instance.t('hub.summary.serverCount', { count: 1 })).toBe('1 servidor');
    expect(instance.t('hub.summary.serverCount', { count: 2 })).toBe('2 servidores');
    expect(instance.t('hub.summary.history', { count: 1 })).toBe('Manter até 1 item');
    expect(instance.t('hub.summary.history', { count: 10 })).toBe('Manter até 10 itens');
  });
});

describe('language resolution', () => {
  afterEach(() => mockGetLocales.mockReset());

  it.each(['zh-CN', 'en', 'ru', 'pt-BR'])('accepts explicit preference %s', (language) => {
    expect(resolvePreference(language)).toBe(language);
  });

  it.each([
    ['ru', 'ru'],
    ['pt', 'pt-BR'],
    ['pt-PT', 'pt-BR'],
    ['fr', 'zh-CN'],
  ])('maps device locale %s to %s', (deviceLocale, expected) => {
    setDeviceLanguage(deviceLocale.split('-')[0]);
    expect(resolveDeviceLanguage()).toBe(expected);
  });

  it('uses the first supported locale in device preference order', () => {
    mockGetLocales.mockReturnValue([
      { languageCode: 'fr' },
      { languageCode: 'ru' },
      { languageCode: 'pt' },
    ] as unknown as ReturnType<typeof getLocales>);

    expect(resolveDeviceLanguage()).toBe('ru');
  });

  it('falls back for an unknown preference', () => {
    setDeviceLanguage('fr');
    expect(resolvePreference('unknown')).toBe('zh-CN');
  });
});
