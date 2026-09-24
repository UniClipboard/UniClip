import { Text as ComposeText } from '@expo/ui/jetpack-compose';
import { useTranslation } from 'react-i18next';

import { SettingsConfirmationSheet } from './android/SettingsConfirmationSheet';
import { useTheme } from '@/hooks/useTheme';
import type { SyncChannelConfirmationSheetProps } from './SyncChannelConfirmationSheet.types';

/**
 * 切换到设备直连前的确认弹层。它由 SyncChannelSection 渲染在设备页的 Compose LazyColumn
 * 里,因此必须是 Compose 原生 ModalBottomSheet(与同页的邀请 / 设备详情弹层一致):
 * RN Modal 作为 LazyColumn 的 item 会被量成全屏高,关闭后列表仍保留这段高度,向下滑动
 * 即整页空白。
 */
export function SyncChannelConfirmationSheet({
  visible,
  isConfirming = false,
  onDismiss,
  onConfirm,
}: SyncChannelConfirmationSheetProps) {
  const { t } = useTranslation('settings');
  const { theme } = useTheme();

  if (!visible) return null;

  return (
    <SettingsConfirmationSheet
      visible={visible}
      title={t('syncChannel.confirmationTitle')}
      confirmLabel={t('syncChannel.confirmationConfirm')}
      cancelLabel={t('syncChannel.confirmationCancel')}
      isConfirming={isConfirming}
      onDismiss={onDismiss}
      onConfirm={onConfirm}
    >
      <ComposeText color={theme.colors.textSecondary as string}>
        {t('syncChannel.confirmationDescription')}
      </ComposeText>
      <ComposeText color={theme.colors.textSecondary as string}>
        {t('syncChannel.confirmationCrossNetwork')}
      </ComposeText>
      <ComposeText color={theme.colors.warning as string}>
        {t('syncChannel.confirmationExperimental')}
      </ComposeText>
    </SettingsConfirmationSheet>
  );
}
