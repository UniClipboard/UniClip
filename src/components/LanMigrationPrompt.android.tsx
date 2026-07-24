import { AlertDialog, Host, Text as ComposeText, TextButton } from '@expo/ui/jetpack-compose';
import { useTranslation } from 'react-i18next';

import type { LanMigrationPromptProps } from './LanMigrationPrompt.types';

export function LanMigrationPrompt({
  visible,
  onSetUpP2p,
  onRemindLater,
}: LanMigrationPromptProps) {
  const { t } = useTranslation('settingsSync');
  if (!visible) return null;

  return (
    <Host>
      <AlertDialog onDismissRequest={onRemindLater}>
        <AlertDialog.Title>
          <ComposeText>{t('migration.title')}</ComposeText>
        </AlertDialog.Title>
        <AlertDialog.Text>
          <ComposeText>{t('migration.body')}</ComposeText>
        </AlertDialog.Text>
        <AlertDialog.ConfirmButton>
          <TextButton onClick={onSetUpP2p}>
            <ComposeText>{t('migration.setUpP2p')}</ComposeText>
          </TextButton>
        </AlertDialog.ConfirmButton>
        <AlertDialog.DismissButton>
          <TextButton onClick={onRemindLater}>
            <ComposeText>{t('migration.later')}</ComposeText>
          </TextButton>
        </AlertDialog.DismissButton>
      </AlertDialog>
    </Host>
  );
}
