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
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('settingsSync');
  const showMessage = useSettingsToast();

  const servers = useSettingsStore((s) => s.config?.servers ?? []);
  const activeServerIndex = useSettingsStore((s) => s.config?.activeServerIndex ?? -1);

  const openEdit = useServerFormStore((s) => s.openEdit);
  const openAdd = useServerFormStore((s) => s.openAdd);

  const [deleteTarget, setDeleteTarget] = useState<{ index: number; name: string } | null>(null);

  const handleSetActiveServer = async (index: number) => {
    if (index === activeServerIndex) return;

    try {
      await useSettingsStore.getState().setActiveServer(index);
      const { runtimeStateStorage } = await import('@/services/RuntimeStateStorage');
      await runtimeStateStorage.update({ needsHistoryReorganize: true });
      showMessage(t('toast.serverSwitched'), 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('error.switchFailed'), 'error');
    }
  };

  const handleDeleteServer = async (index: number) => {
    try {
      await useSettingsStore.getState().deleteServer(index);
      showMessage(t('toast.serverDeleted'), 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('error.deleteFailed'), 'error');
    }
  };

  return (
    <SettingsSectionItem
      title={t('server.title')}
      dialogs={
        <>
          {deleteTarget && (
            <AlertDialog onDismissRequest={() => setDeleteTarget(null)}>
              <AlertDialog.Title>
                <ComposeText>{t('server.deleteDialog.title')}</ComposeText>
              </AlertDialog.Title>
              <AlertDialog.Text>
                <ComposeText>
                  {t('server.deleteDialog.message', { name: deleteTarget.name })}
                </ComposeText>
              </AlertDialog.Text>
              <AlertDialog.ConfirmButton>
                <TextButton
                  onClick={() => {
                    const idx = deleteTarget.index;
                    setDeleteTarget(null);
                    handleDeleteServer(idx);
                  }}
                >
                  <ComposeText>{t('action.delete', { ns: 'common' })}</ComposeText>
                </TextButton>
              </AlertDialog.ConfirmButton>
              <AlertDialog.DismissButton>
                <TextButton onClick={() => setDeleteTarget(null)}>
                  <ComposeText>{t('action.cancel', { ns: 'common' })}</ComposeText>
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
            <ComposeText>{t('server.empty.title')}</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <ComposeText>{t('server.empty.desc')}</ComposeText>
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
                      <ComposeText>{t('action.edit', { ns: 'common' })}</ComposeText>
                    </TextButton>
                    <TextButton
                      onClick={() => setDeleteTarget({ index, name: getServerDisplayName(server) })}
                    >
                      <ComposeText>{t('action.delete', { ns: 'common' })}</ComposeText>
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
          <ComposeText>{`＋ ${t('form.addTitle')}`}</ComposeText>
        </ListItem.HeadlineContent>
      </ListItem>
    </SettingsSectionItem>
  );
});
