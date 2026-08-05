export {
  checkForAutomaticUpdate,
  checkForUpdate,
  compareVersions,
  isTestBuildVersion,
  versionToStr,
  parseVersion,
} from './internal/updateService';
export type {
  AutomaticUpdateDependencies,
  AutomaticUpdateSettings,
  ParsedVersion,
  ReleaseAssetInfo,
  UpdateCheckResult,
} from './internal/updateService';
export {
  checkApkCache,
  cleanOldApkCache,
  downloadApk,
  findAssetForAbi,
  getApkCachePath,
  getPreferredAbi,
  installApk,
} from './internal/apkDownloadService';
export type {
  ApkDownloadOptions,
  ApkDownloadProgress,
  ApkSource,
} from './internal/apkDownloadService';
