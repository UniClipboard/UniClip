import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
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
import { AddServerSheet } from '@/components';
import type { AddServerSaveData } from '@/components/AddServerSheet.types';
import { useSettingsStore } from '@/stores';
import {
  buildServerConfigFromAddServerData,
  getAddServerInitialData,
} from './settings/serverFormAdapter';
import type { SettingsPage } from './settings/ios/types';
import { SettingsRootPage } from './settings/ios/SettingsRootPage';
import { ServerListPage } from './settings/ios/ServerListPage';
import { StoragePage } from './settings/ios/StoragePage';
import { KeyboardPage } from './settings/ios/KeyboardPage';
import { SharePage } from './settings/ios/SharePage';
import { ClipboardAccessPage } from './settings/ios/ClipboardAccessPage';

/** UINavigationController-style push/pop spring. */
const PUSH_SPRING = Animation.spring({ response: 0.38, dampingFraction: 0.92 });

const fillModifier = frame({ maxWidth: Infinity, maxHeight: Infinity });

/**
 * Sub-page wrapper: parked off-screen right when inactive, slid to x=0 when
 * active. Stays mounted the whole time — the animation modifier can only
 * animate offset changes on a live view, so swapping via conditional render
 * would pop with no transition.
 */
function SubPageSlide({
  active,
  width,
  children,
}: {
  active: boolean;
  width: number;
  children: React.ReactNode;
}) {
  return (
    <VStack
      modifiers={[fillModifier, offset({ x: active ? 0 : width }), animation(PUSH_SPRING, active)]}
    >
      {children}
    </VStack>
  );
}

/**
 * iOS settings sheet: a hub root page plus in-sheet sub-pages (servers /
 * storage / keyboard / share / clipboard access) layered in a ZStack inside
 * one SwiftUI BottomSheet. Navigation slides pages horizontally with a
 * push/pop parallax, mimicking a native navigation stack.
 */
export const SettingsScreen = () => {
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const { config, isLoaded, loadConfig, addServer, updateServer } = useSettingsStore();

  const [presented, setPresented] = useState(true);
  const [page, setPage] = useState<SettingsPage>('root');
  const [showServerForm, setShowServerForm] = useState(false);
  const [editingServerIndex, setEditingServerIndex] = useState<number | null>(null);

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

  const backToRoot = useCallback(() => setPage('root'), []);

  const servers = config?.servers ?? [];
  const editingServer = editingServerIndex !== null ? servers[editingServerIndex] : undefined;
  const serverFormInitialData = useMemo(
    () => (editingServer ? getAddServerInitialData(editingServer) : undefined),
    [editingServer]
  );

  const openAddServer = useCallback(() => {
    setEditingServerIndex(null);
    setShowServerForm(true);
  }, []);

  const openEditServer = useCallback((index: number) => {
    setEditingServerIndex(index);
    setShowServerForm(true);
  }, []);

  const closeServerForm = useCallback(() => {
    setShowServerForm(false);
    setEditingServerIndex(null);
  }, []);

  const handleSaveServer = useCallback(
    async (data: AddServerSaveData) => {
      if (editingServerIndex !== null) {
        const existing = servers[editingServerIndex];
        await updateServer(editingServerIndex, buildServerConfigFromAddServerData(data, existing));
      } else {
        await addServer(buildServerConfigFromAddServerData(data));
      }
      closeServerForm();
    },
    [editingServerIndex, servers, updateServer, addServer, closeServerForm]
  );

  if (!isLoaded || !config) return null;

  const atRoot = page === 'root';

  return (
    <Host style={{ position: 'absolute', bottom: 0, left: 0, width: 1, height: 1 }}>
      <BottomSheet isPresented={presented} onIsPresentedChange={handleDismiss}>
        <Group modifiers={[presentationDetents(['large']), presentationDragIndicator('visible')]}>
          <VStack modifiers={[fillModifier, ...(iosAccentColor ? [tint(iosAccentColor)] : [])]}>
            <ZStack modifiers={[fillModifier]}>
              {/* Root parallaxes 30% left behind the incoming sub-page, like a nav stack. */}
              <VStack
                modifiers={[
                  fillModifier,
                  offset({ x: atRoot ? 0 : -width * 0.3 }),
                  animation(PUSH_SPRING, atRoot),
                ]}
              >
                <SettingsRootPage onNavigate={setPage} active={atRoot} />
              </VStack>

              <SubPageSlide active={page === 'servers'} width={width}>
                <ServerListPage
                  onBack={backToRoot}
                  onAddServer={openAddServer}
                  onEditServer={openEditServer}
                />
              </SubPageSlide>
              <SubPageSlide active={page === 'storage'} width={width}>
                <StoragePage onBack={backToRoot} active={page === 'storage'} />
              </SubPageSlide>
              <SubPageSlide active={page === 'keyboard'} width={width}>
                <KeyboardPage onBack={backToRoot} active={page === 'keyboard'} />
              </SubPageSlide>
              <SubPageSlide active={page === 'share'} width={width}>
                <SharePage onBack={backToRoot} />
              </SubPageSlide>
              <SubPageSlide active={page === 'clipboard'} width={width}>
                <ClipboardAccessPage onBack={backToRoot} />
              </SubPageSlide>
            </ZStack>

            <AddServerSheet
              visible={showServerForm}
              title={editingServerIndex !== null ? '编辑服务器' : '添加服务器'}
              initialData={serverFormInitialData}
              embeddedInHost
              onClose={closeServerForm}
              onSave={handleSaveServer}
            />
          </VStack>
        </Group>
      </BottomSheet>
    </Host>
  );
};
