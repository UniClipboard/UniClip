import { useCallback, useEffect, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Host, BottomSheet, Group, VStack, ZStack } from '@expo/ui/swift-ui';
import {
  presentationDetents,
  presentationDragIndicator,
  frame,
  tint,
  offset,
  animation,
  Animation,
} from '@expo/ui/swift-ui/modifiers';

import { iosAccentColor } from '@/theme/iosDesignTokens';
import { useSettingsStore } from '@/stores';
import { AddSyncConnectionSheet } from '@/components/AddSyncConnectionSheet';
import type { AddSyncConnectionMode } from '@/components/AddSyncConnectionSheet.types';
import { SpaceInvitationSheet } from '@/components/SpaceInvitationSheet';
import type { SettingsPage } from './settings/ios/types';
import { SettingsRootPage } from './settings/ios/SettingsRootPage';
import { StoragePage } from './settings/ios/StoragePage';
import { KeyboardPage } from './settings/ios/KeyboardPage';
import { SharePage } from './settings/ios/SharePage';
import { ClipboardAccessPage } from './settings/ios/ClipboardAccessPage';
import { DiagnosticsPage } from './settings/ios/DiagnosticsPage';
import { SpacePage } from './settings/ios/SpacePage';
import type { RootStackParamList } from '@/navigation/AppNavigator';

const fillModifier = frame({ maxWidth: Infinity, maxHeight: Infinity });
const PUSH_SPRING = Animation.spring({ response: 0.38, dampingFraction: 0.92 });
const PAGE_TRANSITION_DURATION_MS = 400;

type SettingsSubPage = Exclude<SettingsPage, 'root'>;

function SettingsSubPageOverlay({
  isLeaving,
  onExited,
  children,
}: {
  isLeaving: boolean;
  onExited: () => void;
  children: React.ReactNode;
}) {
  const { width } = useWindowDimensions();
  const [isPresented, setIsPresented] = useState(false);

  useEffect(() => {
    const frameId = requestAnimationFrame(() => setIsPresented(!isLeaving));
    return () => cancelAnimationFrame(frameId);
  }, [isLeaving]);

  useEffect(() => {
    if (!isLeaving) return;
    const timeoutId = setTimeout(onExited, PAGE_TRANSITION_DURATION_MS);
    return () => clearTimeout(timeoutId);
  }, [isLeaving, onExited]);

  return (
    <VStack
      modifiers={[
        fillModifier,
        offset({ x: isPresented ? 0 : width }),
        animation(PUSH_SPRING, isPresented),
      ]}
    >
      {children}
    </VStack>
  );
}

/**
 * iOS settings sheet. The root Form stays stationary behind at most one active
 * sub-page, preserving its scroll position when the user goes back.
 */
export const SettingsScreen = () => {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'Settings'>>();
  const notificationRouteHandled = useRef<number | null>(null);
  const { config, isLoaded, loadConfig } = useSettingsStore();

  const [presented, setPresented] = useState(true);
  const [activePage, setActivePage] = useState<SettingsSubPage | null>(null);
  const [isLeavingPage, setIsLeavingPage] = useState(false);
  const [showSpaceInvitation, setShowSpaceInvitation] = useState(false);
  const [spaceSetupMode, setSpaceSetupMode] = useState<AddSyncConnectionMode | null>(null);

  useEffect(() => {
    if (!isLoaded) loadConfig();
  }, [isLoaded, loadConfig]);

  useEffect(() => {
    const requestId = route.params?.notificationNavigationRequestId;
    if (
      requestId == null ||
      notificationRouteHandled.current === requestId ||
      route.params?.section !== 'space'
    )
      return;
    notificationRouteHandled.current = requestId;
    setActivePage('space');
    setIsLeavingPage(false);
  }, [route.params?.notificationNavigationRequestId, route.params?.section]);

  const handleDismiss = useCallback(
    (p: boolean) => {
      if (!p) {
        setPresented(false);
        navigation.goBack();
      }
    },
    [navigation]
  );

  const openSubPage = useCallback((page: SettingsPage) => {
    if (page === 'root') return;
    setActivePage(page);
    setIsLeavingPage(false);
  }, []);

  const backToRoot = useCallback(() => {
    setShowSpaceInvitation(false);
    setSpaceSetupMode(null);
    setIsLeavingPage(true);
  }, []);

  const removeSubPage = useCallback(() => setActivePage(null), []);

  if (!isLoaded || !config) return null;

  return (
    <Host style={{ position: 'absolute', bottom: 0, left: 0, width: 1, height: 1 }}>
      <BottomSheet isPresented={presented} onIsPresentedChange={handleDismiss}>
        <Group modifiers={[presentationDetents(['large']), presentationDragIndicator('visible')]}>
          <VStack modifiers={[fillModifier, ...(iosAccentColor ? [tint(iosAccentColor)] : [])]}>
            <ZStack modifiers={[fillModifier]}>
              <SettingsRootPage onNavigate={openSubPage} />
              {activePage ? (
                <SettingsSubPageOverlay isLeaving={isLeavingPage} onExited={removeSubPage}>
                  {activePage === 'space' ? (
                    <SpacePage
                      initialDeviceId={route.params?.deviceId}
                      notificationNavigationRequestId={
                        route.params?.notificationNavigationRequestId
                      }
                      onBack={backToRoot}
                      onOpenInvitation={() => setShowSpaceInvitation(true)}
                      onOpenSetup={setSpaceSetupMode}
                    />
                  ) : null}
                  {activePage === 'storage' ? <StoragePage onBack={backToRoot} /> : null}
                  {activePage === 'keyboard' ? <KeyboardPage onBack={backToRoot} /> : null}
                  {activePage === 'share' ? <SharePage onBack={backToRoot} /> : null}
                  {activePage === 'clipboard' ? <ClipboardAccessPage onBack={backToRoot} /> : null}
                  {activePage === 'diagnostics' ? <DiagnosticsPage onBack={backToRoot} /> : null}
                </SettingsSubPageOverlay>
              ) : null}
              <SpaceInvitationSheet
                visible={showSpaceInvitation}
                onClose={() => setShowSpaceInvitation(false)}
              />
              <AddSyncConnectionSheet
                visible={spaceSetupMode !== null}
                initialMode={spaceSetupMode ?? 'choose'}
                embeddedInHost
                persistentPresentation
                onClose={() => setSpaceSetupMode(null)}
                onConnected={() => {
                  setSpaceSetupMode(null);
                  return true;
                }}
              />
            </ZStack>
          </VStack>
        </Group>
      </BottomSheet>
    </Host>
  );
};
