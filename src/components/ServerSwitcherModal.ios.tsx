import React from 'react';
import { Host, BottomSheet, Group, VStack, HStack, Text as SwiftUIText, Spacer, Button as SwiftUIButton, Image } from '@expo/ui/swift-ui';
import { presentationDetents, presentationDragIndicator, font, foregroundStyle, frame, background, padding, shapes, buttonStyle, glassEffect } from '@expo/ui/swift-ui/modifiers';
import type { ServerSwitcherModalProps } from './ServerSwitcherModal.types';

export function ServerSwitcherModal({ visible, servers, activeIndex, onSelect, onClose, onAdd }: ServerSwitcherModalProps) {
  return (
    <Host style={{ position: 'absolute', bottom: 0, left: 0, width: 1, height: 1 }}>
      <BottomSheet
        isPresented={visible}
        onIsPresentedChange={(presented) => { if (!presented) onClose(); }}
      >
        <Group modifiers={[
          presentationDetents(['medium']),
          presentationDragIndicator('visible'),
        ]}>
          <VStack modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), padding({ horizontal: 24, top: 24 })]}>
            <HStack modifiers={[frame({ maxWidth: Infinity }), padding({ bottom: 16 })]}>
              <SwiftUIButton onPress={onClose} modifiers={[buttonStyle('plain'), glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'circle' })]}>
                <Image systemName="xmark" size={20} color="#AEAEB2" modifiers={[font({ weight: 'semibold' }), padding()]} />
              </SwiftUIButton>
              <Spacer />
              <SwiftUIText modifiers={[font({ weight: 'semibold', size: 17 })]}>Server</SwiftUIText>
              <Spacer />
              <SwiftUIButton onPress={onAdd} modifiers={[buttonStyle('plain'), glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'circle' })]}>
                <Image systemName="plus" size={20} color="#AEAEB2" modifiers={[font({ weight: 'semibold' }), padding()]} />
              </SwiftUIButton>
            </HStack>

            {servers.length === 0 ? (
              <>
                <Spacer />
                <VStack spacing={8}>
                  <Image systemName="server.rack" size={36} color="#8E8E93" />
                  <SwiftUIText modifiers={[font({ size: 15 }), foregroundStyle('#8E8E93')]}>No servers yet</SwiftUIText>
                  <SwiftUIText modifiers={[font({ size: 13 }), foregroundStyle('#636366')]}>Tap + to add a server</SwiftUIText>
                </VStack>
                <Spacer />
              </>
            ) : (
              servers.map((server, index) => {
                const isActive = index === activeIndex;
                return (
                  <SwiftUIButton key={`${server.url}-${index}`} onPress={() => onSelect(index)}>
                    <HStack spacing={12} alignment="center" modifiers={[
                      padding({ horizontal: 16, vertical: 14 }),
                      background(
                        isActive ? '#1B3F2B' : '#2C2C2E',
                        shapes.roundedRectangle({ cornerRadius: 14, roundedCornerStyle: 'continuous' }),
                      ),
                      frame({ maxWidth: Infinity }),
                    ]}>
                      <Image
                        systemName={isActive ? 'checkmark.circle.fill' : 'circle'}
                        size={28}
                        color={isActive ? '#34C759' : '#8E8E93'}
                      />
                      <VStack alignment="leading" spacing={2}>
                        <SwiftUIText modifiers={[font({ weight: 'medium', size: 17 })]}>{server.name || server.url}</SwiftUIText>
                        <SwiftUIText modifiers={[font({ size: 14 }), foregroundStyle('#8E8E93')]}>{server.url}</SwiftUIText>
                      </VStack>
                      <Spacer />
                    </HStack>
                  </SwiftUIButton>
                );
              })
            )}

            <Spacer />
          </VStack>
        </Group>
      </BottomSheet>
    </Host>
  );
}
