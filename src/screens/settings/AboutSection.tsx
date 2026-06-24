/**
 * 关于 section
 *
 * 版本信息、更新检查与 APK 下载安装全流程、自动检查更新 / 更新到测试版开关。
 * 更新/下载相关 state、下载渠道底部表单、取消下载确认弹窗均内聚于此。
 */
import React, { memo, useEffect, useRef, useState } from 'react';
import { View, Text, Linking } from 'react-native';
import {
  Host,
  Card,
  Column,
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
  type ReleaseAssetInfo,
  type ApkSource,
} from '@/services';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/stores';
import { useSettingsToast } from './SettingsToastContext';
import { settingsStyles as styles } from './settingsStyles';

const appVersion = APP_VERSION;

export const AboutSection = memo(function AboutSection() {
  const { theme } = useTheme();
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
    releaseNotes?: string;
  } | null>(null);

  const downloadAbortRef = useRef<AbortController | null>(null);
  const latestAssetsRef = useRef<ReleaseAssetInfo[]>([]);
  const latestTagRef = useRef<string>('');
  const releaseNotesRef = useRef<string | undefined>(undefined);

  const showDownloadSourceDialog = (
    version: string,
    assets: ReleaseAssetInfo[],
    releaseNotes?: string
  ) => {
    setDownloadSourceSheet({ version, assets, releaseNotes });
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
          showMessage('当前已是最新版本', 'success');
        }
      }
      // 无论是否有更新，清除当前版本及旧版本的 APK 缓存
      cleanOldApkCache(appVersion);
    } catch {
      if (showNoUpdateToast) {
        showMessage('检查更新失败，请检查网络连接', 'error');
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
      const { getSupportedAbis } = await import('native-util');
      const abis = getSupportedAbis();
      preferredAbi = getPreferredAbi(abis);
    } catch (e) {
      console.warn('[UpdateDownload] getSupportedAbis failed:', e);
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
      const { getSupportedAbis } = await import('native-util');
      const abis = getSupportedAbis();
      preferredAbi = getPreferredAbi(abis);
    } catch (e) {
      console.warn('[UpdateDownload] getSupportedAbis failed:', e);
    }

    const asset = findAssetForAbi(assets, preferredAbi as Parameters<typeof findAssetForAbi>[1]);
    if (!asset) {
      showMessage('找不到适合当前设备的 APK', 'error');
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
      console.error('[UpdateDownload] error:', err);
      if (err instanceof Error && err.name === 'AbortError') {
        showMessage('已取消下载', 'info');
      } else {
        showMessage(err instanceof Error ? err.message : '下载失败', 'error');
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
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  const handleToggleUpdateToBeta = async (enabled: boolean) => {
    try {
      await useSettingsStore.getState().setUpdateToBeta(enabled);
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  const switchColors = {
    checkedTrackColor: theme.colors.primary,
    uncheckedTrackColor: theme.colors.divider,
    checkedThumbColor: theme.colors.surface,
    uncheckedThumbColor: theme.colors.textTertiary,
  };
  const buttonColors = { containerColor: theme.colors.primary, contentColor: theme.colors.white };

  return (
    <>
      <View style={styles.section}>
        <View style={styles.sectionHeaderBase}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>关于</Text>
        </View>

        <Host matchContents={{ vertical: true }} style={styles.hostFill}>
          <Card colors={{ containerColor: theme.colors.surface }}>
            <Column modifiers={[fillMaxWidth()]}>
              <ListItem colors={{ containerColor: theme.colors.surface }}>
                <ListItem.OverlineContent>
                  <ComposeText color={theme.colors.textSecondary}>版本</ComposeText>
                </ListItem.OverlineContent>
                <ListItem.HeadlineContent>
                  <ComposeText color={theme.colors.text}>{appVersion}</ComposeText>
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
                        colors={buttonColors}
                      >
                        <ComposeText>
                          {isDownloading
                            ? `下载中 ${Math.round(downloadProgress * 100)}%`
                            : `更新 ${latestVersion}`}
                        </ComposeText>
                      </Button>
                    ) : (
                      <OutlinedButton
                        onClick={() => runUpdateCheck(true, updateToBetaEnabled)}
                        enabled={!isCheckingUpdate}
                        colors={{ contentColor: theme.colors.primary }}
                      >
                        <ComposeText>{isCheckingUpdate ? '检查中...' : '检查更新'}</ComposeText>
                      </OutlinedButton>
                    )}
                    <Spacer modifiers={[widthModifier(8)]} />
                    <Button
                      onClick={() => Linking.openURL('https://github.com/UniClipboard/uc-android')}
                      colors={buttonColors}
                    >
                      <ComposeText>GitHub</ComposeText>
                    </Button>
                  </Row>
                </ListItem.TrailingContent>
              </ListItem>

              <HorizontalDivider color={theme.colors.divider} />

              <ListItem colors={{ containerColor: theme.colors.surface }}>
                <ListItem.HeadlineContent>
                  <ComposeText color={theme.colors.text}>自动检查更新</ComposeText>
                </ListItem.HeadlineContent>
                <ListItem.TrailingContent>
                  <ComposeSwitch
                    value={autoCheckUpdateEnabled}
                    onCheckedChange={handleToggleAutoCheckUpdate}
                    colors={switchColors}
                  />
                </ListItem.TrailingContent>
              </ListItem>

              <HorizontalDivider color={theme.colors.divider} />

              <ListItem colors={{ containerColor: theme.colors.surface }}>
                <ListItem.HeadlineContent>
                  <ComposeText color={theme.colors.text}>更新到测试版</ComposeText>
                </ListItem.HeadlineContent>
                <ListItem.TrailingContent>
                  <ComposeSwitch
                    value={updateToBetaEnabled}
                    onCheckedChange={handleToggleUpdateToBeta}
                    colors={switchColors}
                  />
                </ListItem.TrailingContent>
              </ListItem>
            </Column>
          </Card>
        </Host>
      </View>

      {/* 下载渠道选择底部表单 */}
      {downloadSourceSheet && (
        <Host>
          <ModalBottomSheet onDismissRequest={() => setDownloadSourceSheet(null)}>
            <Column modifiers={[paddingAll(24), fillMaxWidth()]}>
              <ComposeText color={theme.colors.text} style={{ typography: 'titleLarge' }}>
                发现新版本
              </ComposeText>
              <Spacer modifiers={[heightModifier(8)]} />
              <ComposeText color={theme.colors.textSecondary}>
                {`最新版本：${downloadSourceSheet.version}\n当前版本：${appVersion}${
                  downloadSourceSheet.releaseNotes
                    ? `\n\n更新说明：\n${downloadSourceSheet.releaseNotes}`
                    : ''
                }`}
              </ComposeText>
              <Spacer modifiers={[heightModifier(16)]} />
              <Button
                onClick={() => {
                  const s = downloadSourceSheet;
                  setDownloadSourceSheet(null);
                  handleDownloadApk('gitcode', s.version, s.assets);
                }}
                modifiers={[fillMaxWidth()]}
                colors={buttonColors}
              >
                <ComposeText>GitCode 下载</ComposeText>
              </Button>
              <Spacer modifiers={[heightModifier(8)]} />
              <OutlinedButton
                onClick={() => {
                  const s = downloadSourceSheet;
                  setDownloadSourceSheet(null);
                  handleDownloadApk('github', s.version, s.assets);
                }}
                modifiers={[fillMaxWidth()]}
                colors={{ contentColor: theme.colors.primary }}
              >
                <ComposeText>GitHub 下载</ComposeText>
              </OutlinedButton>
            </Column>
          </ModalBottomSheet>
        </Host>
      )}

      {/* 取消下载确认 */}
      <Host>
        {showCancelDownloadDialog && (
          <AlertDialog
            onDismissRequest={() => setShowCancelDownloadDialog(false)}
            colors={{ containerColor: theme.colors.surface }}
          >
            <AlertDialog.Title>
              <ComposeText color={theme.colors.text}>取消下载</ComposeText>
            </AlertDialog.Title>
            <AlertDialog.Text>
              <ComposeText color={theme.colors.textSecondary}>确定要取消下载吗？</ComposeText>
            </AlertDialog.Text>
            <AlertDialog.ConfirmButton>
              <TextButton
                onClick={() => {
                  downloadAbortRef.current?.abort();
                  setShowCancelDownloadDialog(false);
                }}
              >
                <ComposeText>取消下载</ComposeText>
              </TextButton>
            </AlertDialog.ConfirmButton>
            <AlertDialog.DismissButton>
              <TextButton onClick={() => setShowCancelDownloadDialog(false)}>
                <ComposeText>继续下载</ComposeText>
              </TextButton>
            </AlertDialog.DismissButton>
          </AlertDialog>
        )}
      </Host>
    </>
  );
});
