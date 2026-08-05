import { useCallback, useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { Host, BottomSheet, Group, VStack, ZStack } from '@expo/ui/swift-ui';
import {
  presentationDetents,
  presentationDragIndicator,
  frame,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import { iosAccentColor } from '@/theme/iosDesignTokens';
import { useSettingsStore } from '@/stores';
import { SpaceInvitationSheet } from '@/components/SpaceInvitationSheet';
import type { SettingsPage } from './settings/ios/types';
import { SettingsRootPage } from './settings/ios/SettingsRootPage';
import { StoragePage } from './settings/ios/StoragePage';
import { KeyboardPage } from './settings/ios/KeyboardPage';
import { SharePage } from './settings/ios/SharePage';
import { ClipboardAccessPage } from './settings/ios/ClipboardAccessPage';
import { DiagnosticsPage } from './settings/ios/DiagnosticsPage';
import { SpacePage } from './settings/ios/SpacePage';

const fillModifier = frame({ maxWidth: Infinity, maxHeight: Infinity });

/**
 * iOS settings sheet. The root Form stays stationary behind at most one active
 * sub-page, preserving its scroll position when the user goes back.
 */
export const SettingsScreen = () => {
  const navigation = useNavigation();
  const { config, isLoaded, loadConfig } = useSettingsStore();

  const [presented, setPresented] = useState(true);
  const [page, setPage] = useState<SettingsPage>('root');
  const [showSpaceInvitation, setShowSpaceInvitation] = useState(false);

  useEffect(() => {
    if (!isLoaded) loadConfig();
  }, [isLoaded, loadConfig]);

  const handleDismiss = useCallback(
    (p: boolean) => {
      if (!p) {
        setPresented(false);
        navigation.goBack();
      }
    },
    [navigation]
  );

  const backToRoot = useCallback(() => {
    setShowSpaceInvitation(false);
    setPage('root');
  }, []);

  if (!isLoaded || !config) return null;

  return (
    <Host style={{ position: 'absolute', bottom: 0, left: 0, width: 1, height: 1 }}>
      <BottomSheet isPresented={presented} onIsPresentedChange={handleDismiss}>
        <Group modifiers={[presentationDetents(['large']), presentationDragIndicator('visible')]}>
          <VStack modifiers={[fillModifier, ...(iosAccentColor ? [tint(iosAccentColor)] : [])]}>
            <ZStack modifiers={[fillModifier]}>
              <SettingsRootPage onNavigate={setPage} />
              {page === 'space' ? (
                <SpacePage
                  onBack={backToRoot}
                  onOpenInvitation={() => setShowSpaceInvitation(true)}
                />
              ) : null}
              {page === 'storage' ? <StoragePage onBack={backToRoot} /> : null}
              {page === 'keyboard' ? <KeyboardPage onBack={backToRoot} /> : null}
              {page === 'share' ? <SharePage onBack={backToRoot} /> : null}
              {page === 'clipboard' ? <ClipboardAccessPage onBack={backToRoot} /> : null}
              {page === 'diagnostics' ? <DiagnosticsPage onBack={backToRoot} /> : null}
              <SpaceInvitationSheet
                visible={showSpaceInvitation}
                onClose={() => setShowSpaceInvitation(false)}
              />
            </ZStack>
          </VStack>
        </Group>
      </BottomSheet>
    </Host>
  );
};
