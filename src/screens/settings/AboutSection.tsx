/**
 * 关于 section
 *
 * 版本信息、更新检查与 APK 下载安装全流程、自动检查更新 / 更新到测试版开关。
 * 更新/下载相关 state、下载渠道底部表单、取消下载确认弹窗均内聚于此。
 * 作为 item:无独立 Host,底部表单 + 取消确认弹窗作为 item 内 overlay 渲染
 * (见 SettingsSectionItem.dialogs)。
 */
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';
import {
  Row,
  ListItem,
  Switch as ComposeSwitch,
  Button,
  OutlinedButton,
  ModalBottomSheet,
  AlertDialog,
  TextButton,
  Spacer,
  HorizontalDivider,
  Column,
  Text as ComposeText,
} from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  width as widthModifier,
  paddingAll,
  height as heightModifier,
} from '@expo/ui/jetpack-compose/modifiers';
import { APP_VERSION } from '@/constants';
import {
  checkForUpdate,
  getPreferredAbi,
  findAssetForAbi,
  checkApkCache,
  downloadApk,
  installApk,
  cleanOldApkCache,
  selectLocalizedReleaseNotes,
  type ReleaseAssetInfo,
  type ApkSource,
} from '@/services';
import { useSettingsStore } from '@/stores';
import { useSettingsToast } from './SettingsToastContext';
import { SettingsSectionItem } from './SettingsSectionItem';
import { log } from '@/services/Logger';

const appVersion = APP_VERSION;

export const AboutSection = memo(function AboutSection() {
  const { t, i18n } = useTranslation('settingsAbout');
  const showMessage = useSettingsToast();

  const autoCheckUpdateEnabled = useSettingsStore((s) => s.config?.autoCheckUpdate ?? true);
  const updateToBetaEnabled = useSettingsStore((s) => s.config?.updateToBeta ?? false);

  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [showCancelDownloadDialog, setShowCancelDownloadDialog] = useState(false);
  const [downloadSourceSheet, setDownloadSourceSheet] = useState<{
    version: string;
    assets: ReleaseAssetInfo[];
    releaseNotesBody?: string;
  } | null>(null);
  const localizedReleaseNotes = selectLocalizedReleaseNotes(
    downloadSourceSheet?.releaseNotesBody,
    i18n.resolvedLanguage ?? i18n.language
  );

  const downloadAbortRef = useRef<AbortController | null>(null);
  const latestAssetsRef = useRef<ReleaseAssetInfo[]>([]);
  const latestTagRef = useRef<string>('');
  const releaseNotesRef = useRef<string | undefined>(undefined);

  const showDownloadSourceDialog = (
    version: string,
    assets: ReleaseAssetInfo[],
    releaseNotesBody?: string
  ) => {
    setDownloadSourceSheet({ version, assets, releaseNotesBody });
  };

  const runUpdateCheck = async (showNoUpdateToast: boolean, includeBeta?: boolean) => {
    setIsCheckingUpdate(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await useSettingsStore.getState().setLastUpdateCheckDate(today);
      const useBeta = includeBeta ?? useSettingsStore.getState().config?.updateToBeta ?? false;
      const result = await checkForUpdate(appVersion, useBeta);
      if (result.hasUpdate) {
        setUpdateAvailable(true);
        setLatestVersion(result.latestVersion);
        latestAssetsRef.current = result.assets;
        latestTagRef.current = result.tagName;
        releaseNotesRef.current = result.releaseNotes;
        showDownloadSourceDialog(result.latestVersion, result.assets, result.releaseNotes);
      } else {
        setUpdateAvailable(false);
        setLatestVersion(null);
        if (showNoUpdateToast) {
          showMessage(t('update.upToDate'), 'success');
        }
      }
      // 无论是否有更新，清除当前版本及旧版本的 APK 缓存
      cleanOldApkCache(appVersion);
    } catch {
      if (showNoUpdateToast) {
        showMessage(t('update.checkFailed'), 'error');
      }
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  // 自动检查更新（每天一次），仅挂载时执行
  useEffect(() => {
    const cfg = useSettingsStore.getState().config;
    if (!(cfg?.autoCheckUpdate ?? true)) return;
    (async () => {
      const { runtimeStateStorage } = await import('@/services/RuntimeStateStorage');
      const runtimeState = await runtimeStateStorage.load();
      const today = new Date().toISOString().slice(0, 10);
      if (!(cfg?.debugUpdateCheckNoLimit ?? false) && runtimeState.lastUpdateCheckDate === today) {
        return;
      }
      runUpdateCheck(false, cfg?.updateToBeta ?? false);
    })();
  }, []);

  const handleUpdateButtonPress = async (
    version: string,
    assets: ReleaseAssetInfo[],
    releaseNotes?: string
  ) => {
    if (isDownloading) return;

    let preferredAbi: string = 'universal';
    try {
      const { getSupportedAbis } = await import('android-util');
      const abis = getSupportedAbis();
      preferredAbi = getPreferredAbi(abis);
    } catch (e) {
      log.warn('[UpdateDownload] getSupportedAbis failed:', e);
    }

    const asset = findAssetForAbi(assets, preferredAbi as Parameters<typeof findAssetForAbi>[1]);
    if (!asset) {
      showDownloadSourceDialog(version, assets, releaseNotes);
      return;
    }

    const cached = await checkApkCache(version, asset);
    if (cached) {
      await installApk(cached);
    } else {
      showDownloadSourceDialog(version, assets, releaseNotes);
    }
  };

  const handleDownloadApk = async (
    source: ApkSource,
    version: string,
    assets: ReleaseAssetInfo[]
  ) => {
    if (isDownloading) return;

    let preferredAbi: string = 'universal';
    try {
      const { getSupportedAbis } = await import('android-util');
      const abis = getSupportedAbis();
      preferredAbi = getPreferredAbi(abis);
    } catch (e) {
      log.warn('[UpdateDownload] getSupportedAbis failed:', e);
    }

    const asset = findAssetForAbi(assets, preferredAbi as Parameters<typeof findAssetForAbi>[1]);
    if (!asset) {
      showMessage(t('download.noSuitableApk'), 'error');
      return;
    }

    setIsDownloading(true);
    setDownloadProgress(0);

    const abortController = new AbortController();
    downloadAbortRef.current = abortController;

    try {
      const cached = await checkApkCache(version, asset);
      if (cached) {
        await installApk(cached);
        return;
      }

      const fileUri = await downloadApk({
        asset,
        source,
        version,
        signal: abortController.signal,
        onProgress: (info) => {
          setDownloadProgress(info.progress);
        },
      });

      setUpdateAvailable(false);
      setLatestVersion(null);
      await installApk(fileUri);
    } catch (err) {
      log.error('[UpdateDownload] error:', err);
      if (err instanceof Error && err.name === 'AbortError') {
        showMessage(t('download.canceled'), 'info');
      } else {
        showMessage(err instanceof Error ? err.message : t('download.failed'), 'error');
      }
    } finally {
      setIsDownloading(false);
      setDownloadProgress(0);
      downloadAbortRef.current = null;
    }
  };

  const handleToggleAutoCheckUpdate = async (enabled: boolean) => {
    try {
      await useSettingsStore.getState().setAutoCheckUpdate(enabled);
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('error.saveFailed'), 'error');
    }
  };

  const handleToggleUpdateToBeta = async (enabled: boolean) => {
    try {
      await useSettingsStore.getState().setUpdateToBeta(enabled);
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('error.saveFailed'), 'error');
    }
  };

  return (
    <SettingsSectionItem
      title={t('title')}
      dialogs={
        <>
          {/* 下载渠道选择底部表单 */}
          {downloadSourceSheet && (
            <ModalBottomSheet onDismissRequest={() => setDownloadSourceSheet(null)}>
              <Column modifiers={[paddingAll(24), fillMaxWidth()]}>
                <ComposeText style={{ typography: 'titleLarge' }}>
                  {t('download.newVersionTitle')}
                </ComposeText>
                <Spacer modifiers={[heightModifier(8)]} />
                <ComposeText>
                  {`${t('download.latestVersion', { version: downloadSourceSheet.version })}\n${t(
                    'download.currentVersion',
                    { version: appVersion }
                  )}${
                    localizedReleaseNotes
                      ? `\n\n${t('download.releaseNotes', {
                          notes: localizedReleaseNotes,
                        })}`
                      : ''
                  }`}
                </ComposeText>
                <Spacer modifiers={[heightModifier(16)]} />
                <Button
                  onClick={() => {
                    const s = downloadSourceSheet;
                    setDownloadSourceSheet(null);
                    handleDownloadApk('gitee', s.version, s.assets);
                  }}
                  modifiers={[fillMaxWidth()]}
                >
                  <ComposeText>{t('download.gitee')}</ComposeText>
                </Button>
                <Spacer modifiers={[heightModifier(8)]} />
                <OutlinedButton
                  onClick={() => {
                    const s = downloadSourceSheet;
                    setDownloadSourceSheet(null);
                    handleDownloadApk('github', s.version, s.assets);
                  }}
                  modifiers={[fillMaxWidth()]}
                >
                  <ComposeText>{t('download.github')}</ComposeText>
                </OutlinedButton>
              </Column>
            </ModalBottomSheet>
          )}

          {/* 取消下载确认 */}
          {showCancelDownloadDialog && (
            <AlertDialog onDismissRequest={() => setShowCancelDownloadDialog(false)}>
              <AlertDialog.Title>
                <ComposeText>{t('cancelDownload.title')}</ComposeText>
              </AlertDialog.Title>
              <AlertDialog.Text>
                <ComposeText>{t('cancelDownload.message')}</ComposeText>
              </AlertDialog.Text>
              <AlertDialog.ConfirmButton>
                <TextButton
                  onClick={() => {
                    downloadAbortRef.current?.abort();
                    setShowCancelDownloadDialog(false);
                  }}
                >
                  <ComposeText>{t('cancelDownload.confirm')}</ComposeText>
                </TextButton>
              </AlertDialog.ConfirmButton>
              <AlertDialog.DismissButton>
                <TextButton onClick={() => setShowCancelDownloadDialog(false)}>
                  <ComposeText>{t('cancelDownload.dismiss')}</ComposeText>
                </TextButton>
              </AlertDialog.DismissButton>
            </AlertDialog>
          )}
        </>
      }
    >
      <ListItem>
        <ListItem.OverlineContent>
          <ComposeText>{t('versionLabel')}</ComposeText>
        </ListItem.OverlineContent>
        <ListItem.HeadlineContent>
          <ComposeText>{appVersion}</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.TrailingContent>
          <Row>
            {isDownloading || updateAvailable ? (
              <Button
                onClick={() => {
                  if (isDownloading) {
                    setShowCancelDownloadDialog(true);
                  } else {
                    handleUpdateButtonPress(
                      latestVersion ?? '',
                      latestAssetsRef.current,
                      releaseNotesRef.current
                    );
                  }
                }}
                enabled={!isCheckingUpdate}
              >
                <ComposeText>
                  {isDownloading
                    ? t('download.downloading', { percent: Math.round(downloadProgress * 100) })
                    : t('update.updateTo', { version: latestVersion })}
                </ComposeText>
              </Button>
            ) : (
              <OutlinedButton
                onClick={() => runUpdateCheck(true, updateToBetaEnabled)}
                enabled={!isCheckingUpdate}
              >
                <ComposeText>
                  {isCheckingUpdate ? t('update.checking') : t('update.check')}
                </ComposeText>
              </OutlinedButton>
            )}
            <Spacer modifiers={[widthModifier(8)]} />
            <Button onClick={() => Linking.openURL('https://github.com/UniClipboard/uc-android')}>
              <ComposeText>GitHub</ComposeText>
            </Button>
          </Row>
        </ListItem.TrailingContent>
      </ListItem>

      <HorizontalDivider />

      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>{t('autoCheck.label')}</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.TrailingContent>
          <ComposeSwitch
            value={autoCheckUpdateEnabled}
            onCheckedChange={handleToggleAutoCheckUpdate}
          />
        </ListItem.TrailingContent>
      </ListItem>

      <HorizontalDivider />

      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>{t('updateToBeta.label')}</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.TrailingContent>
          <ComposeSwitch value={updateToBetaEnabled} onCheckedChange={handleToggleUpdateToBeta} />
        </ListItem.TrailingContent>
      </ListItem>
    </SettingsSectionItem>
  );
});
