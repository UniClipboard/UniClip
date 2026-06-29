/**
 * 服务器添加 / 编辑 RN <Modal>。
 *
 * RN <Modal>(全屏弹层)不能作为 LazyColumn 的 item(会被原生侧跳过),所以渲染在
 * LazyColumn 之外、与 <Host> 同级。状态来自 serverFormStore(由 ServerSection 的列表触发)。
 */
import React, { memo, useEffect, useMemo } from 'react';
import { AddServerSheet } from '@/components';
import type { AddServerSaveData } from '@/components/AddServerSheet.types';
import { useSettingsStore, usePendingConnectStore } from '@/stores';
import { useSettingsToast } from './SettingsToastContext';
import { useServerFormStore } from './serverFormStore';
import { buildServerConfigFromAddServerData, getAddServerInitialData } from './serverFormAdapter';

export const ServerModals = memo(function ServerModals() {
  const showMessage = useSettingsToast();
  const servers = useSettingsStore((s) => s.config?.servers ?? []);

  const formVisible = useServerFormStore((s) => s.formVisible);
  const editingIndex = useServerFormStore((s) => s.editingIndex);
  const prefill = useServerFormStore((s) => s.prefill);
  const closeForm = useServerFormStore((s) => s.closeForm);
  const openPrefilled = useServerFormStore((s) => s.openPrefilled);

  const consumePendingConnect = usePendingConnectStore((s) => s.consume);
  const pendingConnectIntent = usePendingConnectStore((s) => s.intent);

  // 深链 pendingConnect:有数据就打开预填表单
  useEffect(() => {
    if (pendingConnectIntent && !formVisible) {
      const intent = consumePendingConnect();
      if (!intent) return;
      openPrefilled({
        type: 'syncclipboard',
        url: intent.url,
        urls: intent.urls,
        username: intent.user,
        password: intent.pwd,
        ...(intent.label ? { name: intent.label } : {}),
      });
    }
  }, [pendingConnectIntent, formVisible, consumePendingConnect, openPrefilled]);

  const editingServer = editingIndex !== null ? servers[editingIndex] : undefined;
  const initialData = useMemo(() => {
    if (editingServer) return getAddServerInitialData(editingServer);
    if (prefill) return getAddServerInitialData(prefill);
    return undefined;
  }, [editingServer, prefill]);

  const handleSaveServer = async (data: AddServerSaveData) => {
    try {
      if (editingIndex !== null) {
        const serverConfig = buildServerConfigFromAddServerData(data, editingServer);
        await useSettingsStore.getState().updateServer(editingIndex, serverConfig);
        showMessage('服务器配置已更新', 'success');
      } else {
        const serverConfig = buildServerConfigFromAddServerData(data);
        await useSettingsStore.getState().addServer(serverConfig);
        showMessage('服务器已添加', 'success');
      }
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '操作失败', 'error');
    }
  };

  return (
    <AddServerSheet
      visible={formVisible}
      title={editingIndex !== null ? '编辑服务器' : '添加服务器'}
      initialData={initialData}
      onClose={closeForm}
      onSave={handleSaveServer}
    />
  );
});
