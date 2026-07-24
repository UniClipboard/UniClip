import { useRef } from 'react';
import { StyleSheet } from 'react-native';
import { Alert, Button as SwiftUIButton, Host, Text as SwiftUIText } from '@expo/ui/swift-ui';
import { opacity } from '@expo/ui/swift-ui/modifiers';
import { useTranslation } from 'react-i18next';

import type { LanMigrationPromptProps } from './LanMigrationPrompt.types';

export function LanMigrationPrompt({
  visible,
  onSetUpP2p,
  onRemindLater,
}: LanMigrationPromptProps) {
  const { t } = useTranslation('settingsSync');
  const handledByAction = useRef(false);

  const run = (action: () => void) => {
    handledByAction.current = true;
    action();
  };

  return (
    <Host style={styles.host}>
      <Alert
        title={t('migration.title')}
        isPresented={visible}
        onIsPresentedChange={(presented) => {
          if (presented) {
            handledByAction.current = false;
          } else if (!handledByAction.current && visible) {
            onRemindLater();
          }
        }}
      >
        <Alert.Trigger>
          <SwiftUIButton label="" onPress={() => {}} modifiers={[opacity(0)]} />
        </Alert.Trigger>
        <Alert.Actions>
          <SwiftUIButton label={t('migration.setUpP2p')} onPress={() => run(onSetUpP2p)} />
          <SwiftUIButton
            label={t('migration.later')}
            role="cancel"
            onPress={() => run(onRemindLater)}
          />
        </Alert.Actions>
        <Alert.Message>
          <SwiftUIText>{t('migration.body')}</SwiftUIText>
        </Alert.Message>
      </Alert>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', width: 0, height: 0 },
});
