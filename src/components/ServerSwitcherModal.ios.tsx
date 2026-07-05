import React, { useState, useCallback, useMemo } from 'react';
import { Alert, StyleSheet, useColorScheme } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  Host,
  BottomSheet,
  Group,
  List,
  VStack,
  Text as SwiftUIText,
  Spacer,
  Button as SwiftUIButton,
  Image,
  HStack,
  SwipeActions,
} from '@expo/ui/swift-ui';
import {
  presentationDetents,
  presentationDragIndicator,
  font,
  foregroundStyle,
  frame,
  padding,
  buttonStyle,
  glassEffect,
  background,
  shapes,
  contentShape,
  onTapGesture,
  listStyle,
  scrollContentBackground,
  listRowBackground,
  listRowSeparator,
  listRowInsets,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { IosSheetPage } from '@/components/ui';
import { iosColors, iosKindTints, hexToRgba } from '@/theme/iosDesignTokens';
import { useSettingsStore } from '@/stores';
import type { ServerSwitcherModalProps } from './ServerSwitcherModal.types';
import type { ServerConfig } from '@/types/api';
import { AddServerSheet } from './AddServerSheet';
import type { AddServerSaveData } from './AddServerSheet.types';
import {
  classifyURL,
  effectiveURLs,
  getURLClassDisplay,
  URL_CLASS_DISPLAY_ORDER,
  type ServerURLClass,
} from '@/utils/classifyUrl';
import type { SFSymbol } from 'sf-symbols-typescript';

const ACTIVE_TINT = iosKindTints.image; // system green — 「已选中/已连接」语义
const SHEET_BG = iosColors?.systemGroupedBackground ?? '#F2F2F7'; // 与 IosSheetPage 同源

function useNetworkTags(server: ServerConfig) {
  return useMemo(() => {
    const urls = effectiveURLs(server.urls, server.url);
    const classSet = new Set<ServerURLClass>();
    for (const u of urls) classSet.add(classifyURL(u));
    const tags = URL_CLASS_DISPLAY_ORDER.filter((c) => classSet.has(c)).map((c) =>
      getURLClassDisplay(c)
    );
    return { count: urls.length, tags };
  }, [server.urls, server.url]);
}

function toEditData(server: ServerConfig): AddServerSaveData {
  return {
    name: server.name ?? '',
    urls: server.urls && server.urls.length > 0 ? server.urls : [server.url],
    username: server.username ?? '',
    password: server.password ?? '',
  };
}

function ServerCard({
  server,
  isActive,
  onSelect,
  onEdit,
  onDelete,
}: {
  server: ServerConfig;
  isActive: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('serverSwitch');
  const { count, tags } = useNetworkTags(server);
  const isDark = useColorScheme() === 'dark';
  const cardFill = isActive
    ? hexToRgba(ACTIVE_TINT, isDark ? 0.18 : 0.1)
    : iosColors!.secondarySystemGroupedBackground;

  return (
    // 左滑露出操作:SwiftUI swipeActions 只在 List 行上生效;
    // trailing 组内先声明的按钮最靠边缘,整滑触发第一个(删除,有 Alert 兜底确认)
    <SwipeActions
      modifiers={[
        listRowBackground(SHEET_BG),
        listRowSeparator('hidden'),
        listRowInsets({ top: 5, bottom: 5, leading: 16, trailing: 16 }),
      ]}
    >
      <SwipeActions.Actions edge="trailing">
        <SwiftUIButton
          label={t('action.delete', { ns: 'common' })}
          role="destructive"
          systemImage="trash"
          onPress={onDelete}
        />
        <SwiftUIButton
          label={t('action.edit', { ns: 'common' })}
          systemImage="pencil"
          onPress={onEdit}
          modifiers={[tint(iosKindTints.text)]}
        />
      </SwipeActions.Actions>
      <HStack
        spacing={12}
        alignment="center"
        modifiers={[
          padding({ horizontal: 16, vertical: 14 }),
          frame({ maxWidth: Infinity }),
          background(cardFill, shapes.roundedRectangle({ cornerRadius: 22 })),
          contentShape(shapes.rectangle()),
          onTapGesture(onSelect),
        ]}
      >
        <Image
          systemName={isActive ? 'checkmark.circle.fill' : 'circle'}
          size={26}
          color={isActive ? ACTIVE_TINT : undefined}
          modifiers={
            isActive ? [] : [foregroundStyle({ type: 'hierarchical', style: 'quaternary' })]
          }
        />
        <VStack alignment="leading" spacing={3}>
          <SwiftUIText
            modifiers={[
              font({ weight: isActive ? 'semibold' : 'medium', size: 17 }),
              foregroundStyle(iosColors!.label),
            ]}
          >
            {server.name || server.url}
          </SwiftUIText>
          <SwiftUIText modifiers={[font({ size: 14 }), foregroundStyle(iosColors!.secondaryLabel)]}>
            {server.url}
          </SwiftUIText>
          <HStack
            spacing={8}
            alignment="center"
            modifiers={[foregroundStyle(iosColors!.tertiaryLabel)]}
          >
            {tags.map((tag) => (
              <HStack key={tag.label} spacing={3} alignment="center">
                <Image systemName={tag.icon as SFSymbol} size={11} />
                <SwiftUIText modifiers={[font({ size: 12 })]}>{tag.label}</SwiftUIText>
              </HStack>
            ))}
            <SwiftUIText modifiers={[font({ size: 12 })]}>
              {t('card.addressCount', { count })}
            </SwiftUIText>
          </HStack>
        </VStack>
        <Spacer />
      </HStack>
    </SwipeActions>
  );
}

function EmptyState() {
  const { t } = useTranslation('serverSwitch');
  return (
    <>
      <Spacer />
      <VStack spacing={8} modifiers={[frame({ maxWidth: Infinity })]}>
        <Image
          systemName="server.rack"
          size={38}
          modifiers={[foregroundStyle(iosColors!.tertiaryLabel)]}
        />
        <SwiftUIText modifiers={[font({ size: 16 }), foregroundStyle(iosColors!.secondaryLabel)]}>
          {t('empty.title')}
        </SwiftUIText>
        <SwiftUIText modifiers={[font({ size: 13 }), foregroundStyle(iosColors!.tertiaryLabel)]}>
          {t('empty.hint')}
        </SwiftUIText>
      </VStack>
      <Spacer />
    </>
  );
}

function headerCircleButton(key: string, systemName: SFSymbol, onPress: () => void) {
  return (
    <SwiftUIButton
      key={key}
      onPress={onPress}
      modifiers={[
        buttonStyle('plain'),
        glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'circle' }),
      ]}
    >
      <Image
        systemName={systemName}
        size={20}
        modifiers={[
          font({ weight: 'semibold' }),
          padding(),
          foregroundStyle(iosColors!.secondaryLabel),
        ]}
      />
    </SwiftUIButton>
  );
}

export function ServerSwitcherModal({
  visible,
  servers,
  activeIndex,
  onSelect,
  onClose,
}: ServerSwitcherModalProps) {
  const { t } = useTranslation('serverSwitch');
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const { addServer, updateServer, deleteServer } = useSettingsStore();

  const editingServer = editingIndex != null ? servers[editingIndex] : undefined;
  const sheetVisible = showAddSheet || editingServer != null;

  const handleDelete = useCallback(
    (index: number) => {
      const server = servers[index];
      const label = server?.name || server?.url || t('delete.fallbackName');
      Alert.alert(t('delete.title'), t('delete.message', { name: label }), [
        { text: t('action.cancel', { ns: 'common' }), style: 'cancel' },
        {
          text: t('action.delete', { ns: 'common' }),
          style: 'destructive',
          onPress: () => void deleteServer(index),
        },
      ]);
    },
    [servers, deleteServer, t]
  );

  const handleSave = useCallback(
    async (data: AddServerSaveData) => {
      const payload = {
        url: data.urls[0],
        urls: data.urls,
        name: data.name || undefined,
        username: data.username,
        password: data.password,
      };
      if (editingIndex != null) {
        await updateServer(editingIndex, payload);
      } else {
        await addServer({ type: 'syncclipboard', ...payload });
      }
      setShowAddSheet(false);
      setEditingIndex(null);
    },
    [editingIndex, updateServer, addServer]
  );

  const closeSheet = useCallback(() => {
    setShowAddSheet(false);
    setEditingIndex(null);
  }, []);

  return (
    <>
      <Host style={styles.host}>
        <BottomSheet
          isPresented={visible}
          onIsPresentedChange={(presented) => {
            if (!presented) onClose();
          }}
        >
          {/* 固定单一 medium detent:Host 常驻时 SwiftUI 会记住上次 detent,
              multi-detent 会导致「关闭再打开自动变全屏」 */}
          <Group
            modifiers={[presentationDetents(['medium']), presentationDragIndicator('visible')]}
          >
            <IosSheetPage
              title={t('title')}
              spacing={0}
              leftSlots={[headerCircleButton('close', 'xmark', onClose)]}
              rightSlots={[headerCircleButton('add', 'plus', () => setShowAddSheet(true))]}
            >
              {servers.length === 0 ? (
                <EmptyState />
              ) : (
                <List modifiers={[listStyle('plain'), scrollContentBackground('hidden')]}>
                  {servers.map((server, index) => (
                    <ServerCard
                      key={`${server.url}-${index}`}
                      server={server}
                      isActive={index === activeIndex}
                      onSelect={() => onSelect(index)}
                      onEdit={() => setEditingIndex(index)}
                      onDelete={() => handleDelete(index)}
                    />
                  ))}
                </List>
              )}
            </IosSheetPage>
          </Group>
        </BottomSheet>
      </Host>
      <AddServerSheet
        visible={sheetVisible}
        title={editingServer ? t('sheet.editTitle') : undefined}
        initialData={editingServer ? toEditData(editingServer) : undefined}
        onClose={closeSheet}
        onSave={handleSave}
      />
    </>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', bottom: 0, left: 0, width: 1, height: 1 },
});
