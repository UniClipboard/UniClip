import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { File } from 'expo-file-system';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Host, BottomSheet, Group, VStack, ZStack } from '@expo/ui/swift-ui';
import { useTranslation } from 'react-i18next';
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
import { ShareSendSheet } from '@/components/ShareSendSheet';
import { deleteDiagnosticArchive, type DiagnosticArtifact } from '@/support/diagnostics';
import type { PendingShareJob } from '@/features/transfer';
import { useSettingsStore } from '@/stores';
import { AddSyncConnectionSheet } from '@/components/AddSyncConnectionSheet';
import type { AddSyncConnectionMode } from '@/components/AddSyncConnectionSheet.types';
import { SpaceInvitationSheet } from '@/components/SpaceInvitationSheet';
import { SpaceDeviceDetail } from '@/components/SpaceDeviceDetail';
import { useSpaceDeviceManagement } from '@/components/useSpaceDeviceManagement';
import type { SettingsPage } from './settings/ios/types';
import { SettingsRootPage } from './settings/ios/SettingsRootPage';
import { StoragePage } from './settings/ios/StoragePage';
import { KeyboardPage } from './settings/ios/KeyboardPage';
import { SharePage } from './settings/ios/SharePage';
import { ClipboardAccessPage } from './settings/ios/ClipboardAccessPage';
import { LogSection } from './settings/LogSection';
import { SpacePage } from './settings/ios/SpacePage';
import { DeveloperPage } from './settings/ios/DeveloperPage';
import { LanServersPage } from './settings/ios/LanServersPage';
import { LanServerEditorSheet } from './settings/ios/LanServerEditorSheet';
import { SyncChannelPage } from './settings/ios/SyncChannelPage';
import { usePendingLanConnectStore, type LanConnectIntent } from '@/features/lan-servers';
import {
  canOpenDeviceTrustPreview,
  openDeviceTrustPreview,
} from '@/devtools/deviceTrustPreviewCoordinator';
import type { DeviceTrustPreviewScenarioId } from '@/devtools/deviceTrustPreviewSession';
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
  const { t } = useTranslation('settingsSync');
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Settings'>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Settings'>>();
  const notificationRouteHandled = useRef<number | null>(null);
  const pendingDeviceTrustPreview = useRef<DeviceTrustPreviewScenarioId | null>(null);
  const { config, isLoaded, loadConfig } = useSettingsStore();

  const [presented, setPresented] = useState(true);
  const [diagnosticArchive, setDiagnosticArchive] = useState<DiagnosticArtifact | null>(null);
  const diagnosticJobs = useMemo<PendingShareJob[] | undefined>(
    () => diagnosticArchive ? [{
      id: diagnosticArchive.uri,
      kind: 'file',
      displayName: diagnosticArchive.fileName,
      fileUri: diagnosticArchive.uri,
      byteCount: new File(diagnosticArchive.uri).size,
      mimeType: 'application/zip',
      createdAtMs: Date.now(),
    }] : undefined,
    [diagnosticArchive]
  );
  useEffect(() => {
    return () => {
      if (diagnosticArchive) deleteDiagnosticArchive(diagnosticArchive.uri);
    };
  }, [diagnosticArchive]);
  const [pageStack, setPageStack] = useState<SettingsSubPage[]>([]);
  const activePage = pageStack[pageStack.length - 1] ?? null;
  const [isLeavingPage, setIsLeavingPage] = useState(false);
  const [showSpaceInvitation, setShowSpaceInvitation] = useState(false);
  const [spaceSetupMode, setSpaceSetupMode] = useState<AddSyncConnectionMode | null>(null);
  const [editingLanServerId, setEditingLanServerId] = useState<string | 'new' | null>(null);
  const [lanServerIntent, setLanServerIntent] = useState<LanConnectIntent | null>(null);
  const pendingLanIntent = usePendingLanConnectStore((state) => state.intent);
  const consumePendingLanIntent = usePendingLanConnectStore((state) => state.consume);
  const deviceManagement = useSpaceDeviceManagement({ allowHighImpactActions: true });

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
    setPageStack(['space']);
    setIsLeavingPage(false);
  }, [route.params?.notificationNavigationRequestId, route.params?.section]);

  useEffect(() => {
    if (route.params?.section !== 'lanServers') return;
    setPageStack(['lanServers']);
    setIsLeavingPage(false);
  }, [route.params?.section]);

  useEffect(() => {
    if (!pendingLanIntent) return;
    const intent = consumePendingLanIntent();
    if (!intent) return;
    setPageStack(['lanServers']);
    setIsLeavingPage(false);
    setLanServerIntent(intent);
    setEditingLanServerId('new');
  }, [consumePendingLanIntent, pendingLanIntent]);

  const handlePresentedChange = useCallback((isPresented: boolean) => {
    setPresented(isPresented);
  }, []);

  const handleSheetDismiss = useCallback(() => {
    const pendingPreview = pendingDeviceTrustPreview.current;
    pendingDeviceTrustPreview.current = null;
    deviceManagement.closeDevice();
    if (pendingPreview) openDeviceTrustPreview(pendingPreview);
    navigation.goBack();
  }, [deviceManagement.closeDevice, navigation]);

  const openSubPage = useCallback((page: SettingsPage) => {
    if (page === 'root') return;
    setPageStack((current) => [...current, page]);
    setIsLeavingPage(false);
  }, []);

  const backToRoot = useCallback(() => {
    deviceManagement.closeDevice();
    setShowSpaceInvitation(false);
    setSpaceSetupMode(null);
    setEditingLanServerId(null);
    setLanServerIntent(null);
    setIsLeavingPage(true);
  }, [deviceManagement.closeDevice]);

  const backToPreviousPage = useCallback(() => {
    deviceManagement.closeDevice();
    setShowSpaceInvitation(false);
    setSpaceSetupMode(null);
    setEditingLanServerId(null);
    setLanServerIntent(null);
    if (pageStack.length > 1) {
      setPageStack((current) => current.slice(0, -1));
      return;
    }
    setIsLeavingPage(true);
  }, [deviceManagement.closeDevice, pageStack.length]);

  const removeSubPage = useCallback(() => setPageStack([]), []);

  const openPreview = useCallback((scenarioId: DeviceTrustPreviewScenarioId) => {
    if (!canOpenDeviceTrustPreview()) return false;
    pendingDeviceTrustPreview.current = scenarioId;
    setPresented(false);
    return true;
  }, []);

  if (!isLoaded || !config) return null;

  return (
    <Host style={styles.hostAnchor}>
      <BottomSheet
        isPresented={presented}
        onIsPresentedChange={handlePresentedChange}
        onDismiss={handleSheetDismiss}
      >
        <Group modifiers={[presentationDetents(['large']), presentationDragIndicator('visible')]}>
          <VStack modifiers={[fillModifier, ...(iosAccentColor ? [tint(iosAccentColor)] : [])]}>
            <ZStack modifiers={[fillModifier]}>
              <SettingsRootPage onNavigate={openSubPage} />
              {activePage ? (
                <SettingsSubPageOverlay isLeaving={isLeavingPage} onExited={removeSubPage}>
                  {activePage === 'syncChannel' ? (
                    <SyncChannelPage
                      onBack={backToRoot}
                      onAddLanServer={() => {
                        setLanServerIntent(null);
                        setEditingLanServerId('new');
                      }}
                      onEditLanServer={(serverId) => {
                        setLanServerIntent(null);
                        setEditingLanServerId(serverId);
                      }}
                      onOpenInvitation={() => setShowSpaceInvitation(true)}
                      onOpenSetup={setSpaceSetupMode}
                      deviceManagement={deviceManagement}
                    />
                  ) : null}
                  {activePage === 'space' ? (
                    <SpacePage
                      initialDeviceId={route.params?.deviceId}
                      notificationNavigationRequestId={
                        route.params?.notificationNavigationRequestId
                      }
                      onBack={backToPreviousPage}
                      onOpenInvitation={() => setShowSpaceInvitation(true)}
                      onOpenSetup={setSpaceSetupMode}
                      deviceManagement={deviceManagement}
                    />
                  ) : null}
                  {activePage === 'storage' ? <StoragePage onBack={backToRoot} /> : null}
                  {activePage === 'lanServers' ? (
                    <LanServersPage
                      onBack={backToPreviousPage}
                      onAdd={() => {
                        setLanServerIntent(null);
                        setEditingLanServerId('new');
                      }}
                      onEdit={(serverId) => {
                        setLanServerIntent(null);
                        setEditingLanServerId(serverId);
                      }}
                    />
                  ) : null}
                  {activePage === 'keyboard' ? <KeyboardPage onBack={backToRoot} /> : null}
                  {activePage === 'share' ? <SharePage onBack={backToRoot} /> : null}
                  {activePage === 'clipboard' ? <ClipboardAccessPage onBack={backToRoot} /> : null}
                  {activePage === 'diagnostics' ? (
                    <LogSection onBack={backToRoot} onSendArchive={setDiagnosticArchive} />
                  ) : null}
                  {activePage === 'developer' ? (
                    <DeveloperPage
                      onBack={backToRoot}
                      onOpenPreview={openPreview}
                      onOpenOnboardingPreview={() => navigation.navigate('OnboardingPreview')}
                      onOpenConnectionPreview={() => navigation.navigate('ConnectionPreview')}
                    />
                  ) : null}
                </SettingsSubPageOverlay>
              ) : null}
              <SpaceInvitationSheet
                visible={showSpaceInvitation}
                onClose={() => setShowSpaceInvitation(false)}
              />
              <ShareSendSheet
                visible={diagnosticArchive !== null}
                jobs={diagnosticJobs}
                embeddedInHost
                onClose={() => setDiagnosticArchive(null)}
              />
              <SpaceDeviceDetail
                device={deviceManagement.selectedDevice}
                canRemove={deviceManagement.canRemoveSelected}
                confirmingRemoval={deviceManagement.confirmingRemoval}
                removing={deviceManagement.removing}
                removeErrorMessage={
                  deviceManagement.removeError ? t('space.error.operationFailed') : null
                }
                onClose={deviceManagement.closeDevice}
                onRequestRemove={deviceManagement.requestRemove}
                onCancelRemove={deviceManagement.cancelRemove}
                onConfirmRemove={() => void deviceManagement.confirmRemove()}
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
              <LanServerEditorSheet
                visible={editingLanServerId !== null}
                serverId={
                  editingLanServerId && editingLanServerId !== 'new' ? editingLanServerId : null
                }
                initialIntent={lanServerIntent}
                onClose={() => {
                  setEditingLanServerId(null);
                  setLanServerIntent(null);
                }}
              />
            </ZStack>
          </VStack>
        </Group>
      </BottomSheet>
    </Host>
  );
};

const styles = StyleSheet.create({
  hostAnchor: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: 1,
    height: 1,
  },
});
