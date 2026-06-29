/**
 * 服务器配置 section
 *
 * 服务器列表(切换激活、编辑、删除)+ 添加服务器底部表单。作为 LazyColumn 的 item:列表是
 * 纯 Compose ListItem,删除确认与添加底部表单作为内部化弹窗(dialogs)。服务器配置/扫码用
 * 的 RN <Modal> 渲染在 LazyColumn 之外(见 ServerModals),通过 serverFormStore 通信。
 */
import React, { memo, useState } from 'react';
import {
  Row,
  ListItem,
  TextButton,
  AlertDialog,
  HorizontalDivider,
  Text as ComposeText,
} from '@expo/ui/jetpack-compose';
import { clickable } from '@expo/ui/jetpack-compose/modifiers';
import { ServerConfig } from '@/types/api';
import { useSettingsStore } from '@/stores';
import { useSettingsToast } from './SettingsToastContext';
import { SettingsSectionItem } from './SettingsSectionItem';
import { useServerFormStore } from './serverFormStore';

const getServerDisplayName = (config: ServerConfig): string => {
  if (config.name) return config.name;
  try {
    return new URL(config.url).hostname;
  } catch {
    return config.url;
  }
};

const getServerTypeLabel = (type: string): string => {
  switch (type) {
    case 'syncclipboard':
      return 'SyncClipboard';
    case 's3':
      return 'S3';
    default:
      return 'WebDAV';
  }
};

export const ServerSection = memo(function ServerSection() {
  const showMessage = useSettingsToast();

  const servers = useSettingsStore((s) => s.config?.servers ?? []);
  const activeServerIndex = useSettingsStore((s) => s.config?.activeServerIndex ?? -1);

  const openEdit = useServerFormStore((s) => s.openEdit);
  const openAdd = useServerFormStore((s) => s.openAdd);

  const [deleteTarget, setDeleteTarget] = useState<{ index: number; name: string } | null>(null);

  const handleSetActiveServer = async (index: number) => {
    if (index === activeServerIndex) return;

    try {
      const { getHistorySyncService } = await import('@/services/HistorySyncService');
      getHistorySyncService().cancelAll();
    } catch {
      // ignore
    }

    try {
      await useSettingsStore.getState().setActiveServer(index);
      const { runtimeStateStorage } = await import('@/services/RuntimeStateStorage');
      await runtimeStateStorage.update({ needsHistoryReorganize: true });
      showMessage('已切换服务器', 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '切换失败', 'error');
    }
  };

  const handleDeleteServer = async (index: number) => {
    try {
      await useSettingsStore.getState().deleteServer(index);
      showMessage('服务器已删除', 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '删除失败', 'error');
    }
  };

  return (
    <SettingsSectionItem
      title="服务器"
      dialogs={
        <>
          {deleteTarget && (
            <AlertDialog onDismissRequest={() => setDeleteTarget(null)}>
              <AlertDialog.Title>
                <ComposeText>确认删除</ComposeText>
              </AlertDialog.Title>
              <AlertDialog.Text>
                <ComposeText>{`确定要删除服务器 "${deleteTarget.name}" 吗？`}</ComposeText>
              </AlertDialog.Text>
              <AlertDialog.ConfirmButton>
                <TextButton
                  onClick={() => {
                    const idx = deleteTarget.index;
                    setDeleteTarget(null);
                    handleDeleteServer(idx);
                  }}
                >
                  <ComposeText>删除</ComposeText>
                </TextButton>
              </AlertDialog.ConfirmButton>
              <AlertDialog.DismissButton>
                <TextButton onClick={() => setDeleteTarget(null)}>
                  <ComposeText>取消</ComposeText>
                </TextButton>
              </AlertDialog.DismissButton>
            </AlertDialog>
          )}
        </>
      }
    >
      {servers.length === 0 ? (
        <ListItem>
          <ListItem.HeadlineContent>
            <ComposeText>还没有配置服务器</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <ComposeText>点击下方添加第一个服务器</ComposeText>
          </ListItem.SupportingContent>
        </ListItem>
      ) : (
        servers.map((server, index) => {
          return (
            <React.Fragment key={`${server.url}-${index}`}>
              {index > 0 && <HorizontalDivider />}
              <ListItem modifiers={[clickable(() => handleSetActiveServer(index))]}>
                <ListItem.HeadlineContent>
                  <ComposeText>{getServerDisplayName(server)}</ComposeText>
                </ListItem.HeadlineContent>
                <ListItem.SupportingContent>
                  <ComposeText>
                    {`${getServerTypeLabel(server.type)} · ${
                      server.type === 's3' && server.region ? server.region : server.url
                    }`}
                  </ComposeText>
                </ListItem.SupportingContent>
                <ListItem.TrailingContent>
                  <Row>
                    <TextButton onClick={() => openEdit(index)}>
                      <ComposeText>编辑</ComposeText>
                    </TextButton>
                    <TextButton
                      onClick={() => setDeleteTarget({ index, name: getServerDisplayName(server) })}
                    >
                      <ComposeText>删除</ComposeText>
                    </TextButton>
                  </Row>
                </ListItem.TrailingContent>
              </ListItem>
            </React.Fragment>
          );
        })
      )}

      <HorizontalDivider />

      <ListItem modifiers={[clickable(openAdd)]}>
        <ListItem.HeadlineContent>
          <ComposeText>＋ 添加服务器</ComposeText>
        </ListItem.HeadlineContent>
      </ListItem>
    </SettingsSectionItem>
  );
});
