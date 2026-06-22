import React, { useState, useCallback, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { Host, BottomSheet, Group, VStack, Text as SwiftUIText, Spacer, Button as SwiftUIButton, Image, HStack } from '@expo/ui/swift-ui';
import { presentationDetents, presentationDragIndicator, font, foregroundStyle, frame, padding, buttonStyle, glassEffect, background, shapes } from '@expo/ui/swift-ui/modifiers';
import { SheetHeader } from '@/components/ui';
import { useSettingsStore } from '@/stores';
import type { ServerSwitcherModalProps } from './ServerSwitcherModal.types';
import type { ServerConfig } from '@/types/api';
import { AddServerSheet } from './AddServerSheet';
import type { AddServerSaveData } from './AddServerSheet.types';
import { classifyURL, effectiveURLs, getURLClassDisplay, URL_CLASS_DISPLAY_ORDER, type ServerURLClass } from '@/utils/classifyUrl';
import type { SFSymbol } from 'sf-symbols-typescript';

function useNetworkTags(server: ServerConfig) {
  return useMemo(() => {
    const urls = effectiveURLs(server.urls, server.url);
    const classSet = new Set<ServerURLClass>();
    for (const u of urls) classSet.add(classifyURL(u));
    const tags = URL_CLASS_DISPLAY_ORDER.filter((c) => classSet.has(c)).map((c) => getURLClassDisplay(c));
    return { count: urls.length, tags };
  }, [server.urls, server.url]);
}

function ServerItem({ server, isActive, onPress }: { server: ServerConfig; isActive: boolean; onPress: () => void }) {
  const { count, tags } = useNetworkTags(server);
  const isDark = useColorScheme() === 'dark';
  const bgColor = isActive
    ? (isDark ? '#1A2E1F' : '#F2FBF5')
    : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)');

  return (
    <SwiftUIButton onPress={onPress} modifiers={[buttonStyle('plain'), padding({ horizontal: 20 })]}>
      <HStack spacing={12} alignment="center" modifiers={[
        padding({ horizontal: 16, vertical: 14 }),
        frame({ maxWidth: Infinity }),
        background(bgColor, shapes.roundedRectangle({ cornerRadius: 14 })),
      ]}>
        <Image
          systemName={isActive ? 'checkmark.circle.fill' : 'circle'}
          size={28}
          color={isActive ? '#34C759' : undefined}
          modifiers={isActive ? [] : [foregroundStyle({ type: 'hierarchical', style: 'quaternary' })]}
        />
        <VStack alignment="leading" spacing={2}>
          <SwiftUIText modifiers={[font({ weight: 'medium', size: 17 })]}>{server.name || server.url}</SwiftUIText>
          <SwiftUIText modifiers={[font({ size: 14 }), foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>{server.url}</SwiftUIText>
          <HStack spacing={6} alignment="center" modifiers={[foregroundStyle({ type: 'hierarchical', style: 'tertiary' })]}>
            <SwiftUIText modifiers={[font({ size: 12 })]}>{count} 个地址</SwiftUIText>
            {tags.map((tag) => (
              <HStack key={tag.label} spacing={2} alignment="center">
                <Image systemName={tag.icon as SFSymbol} size={10} />
                <SwiftUIText modifiers={[font({ size: 12 })]}>{tag.label}</SwiftUIText>
              </HStack>
            ))}
          </HStack>
        </VStack>
        <Spacer />
      </HStack>
    </SwiftUIButton>
  );
}

export function ServerSwitcherModal({ visible, servers, activeIndex, onSelect, onClose, onAdd }: ServerSwitcherModalProps) {
  const [showAddSheet, setShowAddSheet] = useState(false);
  const { addServer } = useSettingsStore();

  const handleSaveServer = useCallback(async (data: AddServerSaveData) => {
    await addServer({
      type: 'syncclipboard',
      url: data.urls[0],
      urls: data.urls,
      name: data.name || undefined,
      username: data.username,
      password: data.password,
    });
    setShowAddSheet(false);
  }, [addServer]);

  return (
    <>
    <Host style={{ position: 'absolute', bottom: 0, left: 0, width: 1, height: 1 }}>
      <BottomSheet
        isPresented={visible}
        onIsPresentedChange={(presented) => { if (!presented) onClose(); }}
      >
        <Group modifiers={[
          presentationDetents(['medium']),
          presentationDragIndicator('visible'),
        ]}>
          <VStack spacing={8} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
            <SheetHeader
              title="服务器"
              left={
                <SwiftUIButton onPress={onClose} modifiers={[buttonStyle('plain'), glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'circle' })]}>
                  <Image systemName="xmark" size={20} color="#AEAEB2" modifiers={[font({ weight: 'semibold' }), padding()]} />
                </SwiftUIButton>
              }
              right={
                <SwiftUIButton onPress={() => setShowAddSheet(true)} modifiers={[buttonStyle('plain'), glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'circle' })]}>
                  <Image systemName="plus" size={20} color="#AEAEB2" modifiers={[font({ weight: 'semibold' }), padding()]} />
                </SwiftUIButton>
              }
            />

            {servers.length === 0 ? (
              <>
                <Spacer />
                <VStack spacing={8}>
                  <Image systemName="server.rack" size={36} color="#8E8E93" />
                  <SwiftUIText modifiers={[font({ size: 15 }), foregroundStyle('#8E8E93')]}>No servers yet</SwiftUIText>
                  <SwiftUIText modifiers={[font({ size: 13 }), foregroundStyle({ type: 'hierarchical', style: 'tertiary' })]}>Tap + to add a server</SwiftUIText>
                </VStack>
                <Spacer />
              </>
            ) : (
              servers.map((server, index) => {
                const isActive = index === activeIndex;
                return (
                  <ServerItem
                    key={`${server.url}-${index}`}
                    server={server}
                    isActive={isActive}
                    onPress={() => onSelect(index)}
                  />
                );
              })
            )}

            <Spacer />
          </VStack>
        </Group>
      </BottomSheet>
    </Host>
    <AddServerSheet visible={showAddSheet} onClose={() => setShowAddSheet(false)} onSave={handleSaveServer} />
    </>
  );
}
