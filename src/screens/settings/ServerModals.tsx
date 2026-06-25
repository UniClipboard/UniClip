/**
 * 服务器配置 / 扫码 RN <Modal>。
 *
 * 这俩是 RN <Modal>(全屏弹层),不能作为 LazyColumn 的 item(会被原生侧跳过),所以渲染在
 * LazyColumn 之外、与 <Host> 同级。状态来自 serverFormStore(由 ServerSection 的列表触发),
 * 保存逻辑与深链 pendingConnect 预填也在这里。
 */
import React, { memo, useEffect } from 'react';
import { ServerConfigModal, QrScannerModal } from '@/components';
import { ServerConfig } from '@/types/api';
import { useSettingsStore, usePendingConnectStore } from '@/stores';
import { useSettingsToast } from './SettingsToastContext';
import { useServerFormStore } from './serverFormStore';

export const ServerModals = memo(function ServerModals() {
  const showMessage = useSettingsToast();
  const servers = useSettingsStore((s) => s.config?.servers ?? []);

  const formVisible = useServerFormStore((s) => s.formVisible);
  const editingIndex = useServerFormStore((s) => s.editingIndex);
  const prefill = useServerFormStore((s) => s.prefill);
  const scannerVisible = useServerFormStore((s) => s.scannerVisible);
  const closeForm = useServerFormStore((s) => s.closeForm);
  const closeScanner = useServerFormStore((s) => s.closeScanner);
  const openPrefilled = useServerFormStore((s) => s.openPrefilled);

  const consumePendingConnect = usePendingConnectStore((s) => s.consume);
  const pendingConnectIntent = usePendingConnectStore((s) => s.intent);

  // 深链 pendingConnect:有数据就打开预填表单
  useEffect(() => {
    if (pendingConnectIntent && !formVisible && !scannerVisible) {
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
  }, [pendingConnectIntent, formVisible, scannerVisible, consumePendingConnect, openPrefilled]);

  const handleSaveServer = async (serverConfig: ServerConfig) => {
    try {
      if (editingIndex !== null) {
        await useSettingsStore.getState().updateServer(editingIndex, serverConfig);
        showMessage('服务器配置已更新', 'success');
      } else {
        await useSettingsStore.getState().addServer(serverConfig);
        showMessage('服务器已添加', 'success');
      }
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '操作失败', 'error');
    }
  };

  return (
    <>
      <ServerConfigModal
        visible={formVisible}
        onClose={closeForm}
        onSave={handleSaveServer}
        initialConfig={editingIndex !== null ? servers[editingIndex] : (prefill ?? undefined)}
        isEditing={editingIndex !== null}
      />
      <QrScannerModal visible={scannerVisible} onClose={closeScanner} />
    </>
  );
});
