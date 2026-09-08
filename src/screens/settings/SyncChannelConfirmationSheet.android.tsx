import { StyleSheet } from 'react-native';
import { Text as ComposeText } from '@expo/ui/jetpack-compose';
import { useTranslation } from 'react-i18next';

import { AppBottomSheet, AppButton, AppColumn, AppHost } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import type { SyncChannelConfirmationSheetProps } from './SyncChannelConfirmationSheet.types';

export function SyncChannelConfirmationSheet({
  visible,
  isConfirming = false,
  onDismiss,
  onConfirm,
}: SyncChannelConfirmationSheetProps) {
  const { t } = useTranslation('settings');
  const { theme } = useTheme();

  return (
    <AppBottomSheet visible={visible} onDismiss={isConfirming ? () => {} : onDismiss}>
      <AppHost
        matchContents={{ vertical: true }}
        style={styles.host}
        colorScheme={theme.isDark ? 'dark' : 'light'}
        seedColor={theme.colors.accent}
      >
        <AppColumn fullWidth spacing={16} padding={24}>
          <ComposeText style={styles.title}>{t('syncChannel.confirmationTitle')}</ComposeText>
          <ComposeText color={theme.colors.textSecondary as string}>
            {t('syncChannel.confirmationDescription')}
          </ComposeText>
          <ComposeText color={theme.colors.textSecondary as string}>
            {t('syncChannel.confirmationCrossNetwork')}
          </ComposeText>
          <ComposeText color={theme.colors.warning as string}>
            {t('syncChannel.confirmationExperimental')}
          </ComposeText>
          <AppButton
            title={t('syncChannel.confirmationConfirm')}
            onPress={() => void onConfirm()}
            fullWidth
            size="large"
            disabled={isConfirming}
          />
          <AppButton
            title={t('syncChannel.confirmationCancel')}
            onPress={onDismiss}
            variant="text"
            fullWidth
            disabled={isConfirming}
          />
        </AppColumn>
      </AppHost>
    </AppBottomSheet>
  );
}

const styles = StyleSheet.create({
  host: { width: '100%' },
  title: { fontSize: 24, fontWeight: '700' },
});
