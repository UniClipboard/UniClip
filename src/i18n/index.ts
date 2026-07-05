/**
 * i18next 初始化(应用全局单例)。
 *
 * - 导入本文件即完成初始化(副作用);在 index.ts 入口顶部 import,保证所有
 *   AppRegistry 入口(main / quickAction / serviceRestart)在渲染任何组件前就绪。
 * - 初始语言取系统语言;用户显式偏好由 App 在配置加载后经 applyLanguagePreference 应用。
 * - resources 全部静态打包,故 useSuspense 关闭,组件无需等待异步加载。
 * - 组件内用 useTranslation();非组件(store/util/Alert)用 `import i18n from '@/i18n'; i18n.t(...)`。
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { FALLBACK_LANGUAGE, SUPPORTED_LANGUAGES, resolveDeviceLanguage } from './languages';
import { DEFAULT_NS, NS_LIST, resources } from './resources';

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: resolveDeviceLanguage(),
    fallbackLng: FALLBACK_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
    ns: NS_LIST as unknown as string[],
    defaultNS: DEFAULT_NS,
    // 缺失键回退到 fallbackLng 的同名键
    returnNull: false,
    returnEmptyString: false,
    interpolation: {
      // RN 无 XSS 风险,关闭转义以保留原文
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });
}

export default i18n;
export { i18n };
