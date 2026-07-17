/**
 * 语言偏好读写。
 *
 * - applyLanguagePreference: 把偏好解析为实际语言并切换 i18next(供 App 启动/非组件调用)。
 * - useAppLanguage: 组件用,返回当前偏好、已解析语言,以及持久化并即时生效的 setLanguage。
 *
 * 偏好持久化复用 settings.language 字段('system' | 'zh-CN' | 'en' | 'ru' | 'pt-BR')。
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useSettingsStore } from '@/stores';
import i18n from './index';
import { LanguagePreference, resolvePreference } from './languages';

/**
 * 将语言偏好应用到 i18next(必要时才 changeLanguage,避免无谓重渲染)。
 * 非组件场景(App 启动、后台入口)直接调用。
 */
export function applyLanguagePreference(
  pref: LanguagePreference | string | null | undefined
): void {
  const resolved = resolvePreference(pref);
  if (i18n.language !== resolved) {
    void i18n.changeLanguage(resolved);
  }
}

export interface UseAppLanguageResult {
  /** 用户偏好('system' 跟随系统) */
  preference: LanguagePreference;
  /** i18next 当前实际使用的语言 */
  resolvedLanguage: string;
  /** 设置偏好:即时切换 + 持久化 */
  setLanguage: (pref: LanguagePreference) => Promise<void>;
}

export function useAppLanguage(): UseAppLanguageResult {
  const { i18n: i18nInstance } = useTranslation();
  const preference = (useSettingsStore((s) => s.config?.language) ??
    'system') as LanguagePreference;

  const setLanguage = useCallback(async (pref: LanguagePreference) => {
    applyLanguagePreference(pref);
    await useSettingsStore.getState().updateConfig({ language: pref });
  }, []);

  return { preference, resolvedLanguage: i18nInstance.language, setLanguage };
}
