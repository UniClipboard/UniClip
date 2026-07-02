/**
 * 同步设置 section(「服务器与同步」二级页)
 *
 * 拆为两张卡:「同步选项」(Toast 通知、自动同步数据大小)与「高级」(轮询间隔)。
 * 「自动同步」总开关已上移到一级设置页的主开关卡片。
 * 只订阅自身相关的 config 字段,输入框为受控本地状态、提交时通过 getState() 读写
 * store。这样切换其它 section 的开关不会重渲本组件,反之亦然。
 */
import React, { memo, useState } from 'react';
import {
  ListItem,
  Switch as ComposeSwitch,
  OutlinedTextField,
  HorizontalDivider,
  Text as ComposeText,
  useNativeState,
} from '@expo/ui/jetpack-compose';
import { width as widthModifier } from '@expo/ui/jetpack-compose/modifiers';
import { useSettingsStore } from '@/stores';
import { useSettingsToast } from './SettingsToastContext';
import { useBlurCommit } from './useBlurCommit';
import { SettingsSectionItem } from './SettingsSectionItem';

const toMB = (bytes: number) => Math.round(bytes / (1024 * 1024));
const filterPositiveInteger = (value: string): string => {
  const filtered = value.replace(/[^0-9]/g, '');
  if (filtered === '') return '';
  const num = parseInt(filtered, 10);
  return num > 0 ? filtered : '';
};

export const SyncSettingsSection = memo(function SyncSettingsSection() {
  const showMessage = useSettingsToast();

  // 仅订阅影响本 section 渲染的字段
  const syncToastEnabled = useSettingsStore((s) => s.config?.syncToastEnabled ?? true);
  const isSyncClipboard = useSettingsStore((s) => {
    const c = s.config;
    const i = c?.activeServerIndex ?? -1;
    return i >= 0 ? c?.servers?.[i]?.type === 'syncclipboard' : false;
  });

  // 受控输入：初始值取挂载时的 config，提交/回退时用 getState 读最新值
  const [maxSizeInput, setMaxSizeInput] = useState(() => {
    const c = useSettingsStore.getState().config;
    return toMB(c?.autoDownloadMaxSize ?? 5 * 1024 * 1024).toString();
  });
  const [remotePollingInput, setRemotePollingInput] = useState(() => {
    const c = useSettingsStore.getState().config;
    return ((c?.remotePollingInterval ?? 3000) / 1000).toString();
  });
  const [localPollingInput, setLocalPollingInput] = useState(() => {
    const c = useSettingsStore.getState().config;
    return ((c?.localPollingInterval ?? 1000) / 1000).toString();
  });

  const maxSizeNativeState = useNativeState(maxSizeInput);
  const remotePollingNativeState = useNativeState(remotePollingInput);
  const localPollingNativeState = useNativeState(localPollingInput);

  const handleToggleSyncToast = async (enabled: boolean) => {
    try {
      await useSettingsStore.getState().updateConfig({ syncToastEnabled: enabled });
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  const handleMaxSizeBlur = async () => {
    const resetToCurrent = () =>
      setMaxSizeInput(
        toMB(useSettingsStore.getState().config?.autoDownloadMaxSize ?? 5 * 1024 * 1024).toString()
      );
    try {
      const sizeMB = parseInt(maxSizeInput, 10);
      if (isNaN(sizeMB) || sizeMB < 0) {
        resetToCurrent();
        showMessage('请输入有效的数字', 'error');
        return;
      }
      await useSettingsStore.getState().setAutoDownloadMaxSize(sizeMB * 1024 * 1024);
    } catch (error: unknown) {
      resetToCurrent();
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  const handleRemotePollingBlur = async () => {
    const resetToCurrent = () =>
      setRemotePollingInput(
        ((useSettingsStore.getState().config?.remotePollingInterval ?? 3000) / 1000).toString()
      );
    try {
      const seconds = parseInt(remotePollingInput, 10);
      if (isNaN(seconds) || seconds < 1) {
        resetToCurrent();
        showMessage('请输入大于等于1的数字', 'error');
        return;
      }
      await useSettingsStore.getState().setRemotePollingInterval(seconds * 1000);
    } catch (error: unknown) {
      resetToCurrent();
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  const handleLocalPollingBlur = async () => {
    const resetToCurrent = () =>
      setLocalPollingInput(
        ((useSettingsStore.getState().config?.localPollingInterval ?? 1000) / 1000).toString()
      );
    try {
      const seconds = parseInt(localPollingInput, 10);
      if (isNaN(seconds) || seconds < 1) {
        resetToCurrent();
        showMessage('请输入大于等于1的数字', 'error');
        return;
      }
      await useSettingsStore.getState().setLocalPollingInterval(seconds * 1000);
    } catch (error: unknown) {
      resetToCurrent();
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  const onMaxSizeFocusChanged = useBlurCommit(handleMaxSizeBlur);
  const onRemotePollingFocusChanged = useBlurCommit(handleRemotePollingBlur);
  const onLocalPollingFocusChanged = useBlurCommit(handleLocalPollingBlur);

  return (
    <>
      <SettingsSectionItem title="同步选项">
        <ListItem>
          <ListItem.HeadlineContent>
            <ComposeText>同步 Toast 通知</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <ComposeText>上传/下载完成后显示 Toast 提示</ComposeText>
          </ListItem.SupportingContent>
          <ListItem.TrailingContent>
            <ComposeSwitch value={syncToastEnabled} onCheckedChange={handleToggleSyncToast} />
          </ListItem.TrailingContent>
        </ListItem>

        <HorizontalDivider />

        <ListItem>
          <ListItem.HeadlineContent>
            <ComposeText>允许自动同步的数据大小</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <ComposeText>小于此大小的文件将自动下载</ComposeText>
          </ListItem.SupportingContent>
          <ListItem.TrailingContent>
            <OutlinedTextField
              value={maxSizeNativeState}
              onValueChange={setMaxSizeInput}
              onFocusChanged={onMaxSizeFocusChanged}
              keyboardOptions={{ keyboardType: 'number' }}
              singleLine
              modifiers={[widthModifier(96)]}
            >
              <OutlinedTextField.Placeholder>
                <ComposeText>5</ComposeText>
              </OutlinedTextField.Placeholder>
              <OutlinedTextField.Suffix>
                <ComposeText>MB</ComposeText>
              </OutlinedTextField.Suffix>
            </OutlinedTextField>
          </ListItem.TrailingContent>
        </ListItem>
      </SettingsSectionItem>

      <SettingsSectionItem title="高级">
        {!isSyncClipboard && (
          <>
            <ListItem>
              <ListItem.HeadlineContent>
                <ComposeText>远程轮询间隔</ComposeText>
              </ListItem.HeadlineContent>
              <ListItem.SupportingContent>
                <ComposeText>拉取远程剪贴板的频率</ComposeText>
              </ListItem.SupportingContent>
              <ListItem.TrailingContent>
                <OutlinedTextField
                  key={remotePollingInput}
                  value={remotePollingNativeState}
                  onValueChange={(text) => setRemotePollingInput(filterPositiveInteger(text))}
                  onFocusChanged={onRemotePollingFocusChanged}
                  keyboardOptions={{ keyboardType: 'number' }}
                  singleLine
                  modifiers={[widthModifier(96)]}
                >
                  <OutlinedTextField.Placeholder>
                    <ComposeText>3</ComposeText>
                  </OutlinedTextField.Placeholder>
                  <OutlinedTextField.Suffix>
                    <ComposeText>秒</ComposeText>
                  </OutlinedTextField.Suffix>
                </OutlinedTextField>
              </ListItem.TrailingContent>
            </ListItem>
            <HorizontalDivider />
          </>
        )}

        <ListItem>
          <ListItem.HeadlineContent>
            <ComposeText>本地轮询间隔</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <ComposeText>检测本机剪贴板变化的频率</ComposeText>
          </ListItem.SupportingContent>
          <ListItem.TrailingContent>
            <OutlinedTextField
              key={localPollingInput}
              value={localPollingNativeState}
              onValueChange={(text) => setLocalPollingInput(filterPositiveInteger(text))}
              onFocusChanged={onLocalPollingFocusChanged}
              keyboardOptions={{ keyboardType: 'number' }}
              singleLine
              modifiers={[widthModifier(96)]}
            >
              <OutlinedTextField.Placeholder>
                <ComposeText>1</ComposeText>
              </OutlinedTextField.Placeholder>
              <OutlinedTextField.Suffix>
                <ComposeText>秒</ComposeText>
              </OutlinedTextField.Suffix>
            </OutlinedTextField>
          </ListItem.TrailingContent>
        </ListItem>
      </SettingsSectionItem>
    </>
  );
});
