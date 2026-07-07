/**
 * i18next 资源汇总。
 *
 * 每个命名空间对应一个领域(见 locales/<lang>/<ns>.json),按领域拆分便于维护与并行迁移。
 * 新增命名空间时:在 locales/zh 和 locales/en 下建同名 JSON,再在此文件登记 import 与 NS_LIST。
 */
import type { AppLanguage } from './languages';

import zhCommon from './locales/zh/common.json';
import zhConnect from './locales/zh/connect.json';
import zhOnboarding from './locales/zh/onboarding.json';
import zhHome from './locales/zh/home.json';
import zhShare from './locales/zh/share.json';
import zhSync from './locales/zh/sync.json';
import zhServer from './locales/zh/server.json';
import zhServerSwitch from './locales/zh/serverSwitch.json';
import zhHistory from './locales/zh/history.json';
import zhErrors from './locales/zh/errors.json';
import zhSettings from './locales/zh/settings.json';
import zhSettingsSync from './locales/zh/settingsSync.json';
import zhSettingsBackground from './locales/zh/settingsBackground.json';
import zhSettingsStorage from './locales/zh/settingsStorage.json';
import zhSettingsAbout from './locales/zh/settingsAbout.json';
import zhSettingsPermissions from './locales/zh/settingsPermissions.json';
import zhSettingsIos from './locales/zh/settingsIos.json';

import enCommon from './locales/en/common.json';
import enConnect from './locales/en/connect.json';
import enOnboarding from './locales/en/onboarding.json';
import enHome from './locales/en/home.json';
import enShare from './locales/en/share.json';
import enSync from './locales/en/sync.json';
import enServer from './locales/en/server.json';
import enServerSwitch from './locales/en/serverSwitch.json';
import enHistory from './locales/en/history.json';
import enErrors from './locales/en/errors.json';
import enSettings from './locales/en/settings.json';
import enSettingsSync from './locales/en/settingsSync.json';
import enSettingsBackground from './locales/en/settingsBackground.json';
import enSettingsStorage from './locales/en/settingsStorage.json';
import enSettingsAbout from './locales/en/settingsAbout.json';
import enSettingsPermissions from './locales/en/settingsPermissions.json';
import enSettingsIos from './locales/en/settingsIos.json';

/** 默认命名空间:未指定 namespace 时 useTranslation()/t() 取此处 */
export const DEFAULT_NS = 'common' as const;

/** 全部命名空间列表(供 i18next init 的 ns 选项) */
export const NS_LIST = [
  'common',
  'connect',
  'onboarding',
  'home',
  'share',
  'sync',
  'server',
  'serverSwitch',
  'history',
  'errors',
  'settings',
  'settingsSync',
  'settingsBackground',
  'settingsStorage',
  'settingsAbout',
  'settingsPermissions',
  'settingsIos',
] as const;

export const resources: Record<AppLanguage, Record<string, object>> = {
  'zh-CN': {
    common: zhCommon,
    connect: zhConnect,
    onboarding: zhOnboarding,
    home: zhHome,
    share: zhShare,
    sync: zhSync,
    server: zhServer,
    serverSwitch: zhServerSwitch,
    history: zhHistory,
    errors: zhErrors,
    settings: zhSettings,
    settingsSync: zhSettingsSync,
    settingsBackground: zhSettingsBackground,
    settingsStorage: zhSettingsStorage,
    settingsAbout: zhSettingsAbout,
    settingsPermissions: zhSettingsPermissions,
    settingsIos: zhSettingsIos,
  },
  en: {
    common: enCommon,
    connect: enConnect,
    onboarding: enOnboarding,
    home: enHome,
    share: enShare,
    sync: enSync,
    server: enServer,
    serverSwitch: enServerSwitch,
    history: enHistory,
    errors: enErrors,
    settings: enSettings,
    settingsSync: enSettingsSync,
    settingsBackground: enSettingsBackground,
    settingsStorage: enSettingsStorage,
    settingsAbout: enSettingsAbout,
    settingsPermissions: enSettingsPermissions,
    settingsIos: enSettingsIos,
  },
};
