import React from 'react';
import { StyleSheet } from 'react-native';
import {
  BottomSheet,
  Button as SwiftUIButton,
  Group,
  Host,
  HStack,
  Image,
  Label,
  Section,
  Spacer,
  Text as SwiftUIText,
} from '@expo/ui/swift-ui';
import {
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  padding,
  presentationDetents,
  presentationDragIndicator,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { useTranslation } from 'react-i18next';
import { IosSheetForm, IosSheetPage } from '@/components/ui';
import type { HistoryFilterSheetProps } from './HistoryFilterSheet.types';
import { getDisplayKindLabel } from '@/utils/displayKind';
import type { DisplayKind } from '@/utils/displayKind';
import {
  getHistoryFilterDateOptions,
  HISTORY_FILTER_KIND_OPTIONS,
} from '@/utils/historyFilterOptions';

const DISPLAY_KIND_SYMBOLS: Record<DisplayKind, SFSymbol> = {
  text: 'doc.text.fill',
  url: 'link',
  image: 'photo.fill',
  file: 'doc.fill',
  group: 'folder.fill',
};

const DISPLAY_KIND_COLORS: Record<DisplayKind, string> = {
  text: '#007AFF',
  url: '#32ADE6',
  image: '#34C759',
  file: '#FF9500',
  group: '#AF52DE',
};

export function HistoryFilterSheet({
  visible,
  selectedKinds,
  selectedDate,
  onToggleKind,
  onSelectDate,
  onClear,
  onClose,
}: HistoryFilterSheetProps) {
  const { t } = useTranslation('history');
  return (
    <Host style={styles.host}>
      <BottomSheet
        isPresented={visible}
        onIsPresentedChange={(presented) => {
          if (!presented) onClose();
        }}
      >
        <Group modifiers={[presentationDetents(['medium']), presentationDragIndicator('visible')]}>
          <IosSheetPage
            title={t('filter.title')}
            left={
              <SwiftUIButton onPress={onClear} modifiers={[buttonStyle('plain')]}>
                <SwiftUIText modifiers={[font({ size: 16 }), foregroundStyle('#007AFF')]}>
                  {t('action.reset', { ns: 'common' })}
                </SwiftUIText>
              </SwiftUIButton>
            }
            rightSlots={[
              <SwiftUIButton
                key="done"
                onPress={onClose}
                modifiers={[
                  buttonStyle('plain'),
                  glassEffect({
                    glass: { variant: 'regular', interactive: true },
                    shape: 'circle',
                  }),
                ]}
              >
                <Image
                  systemName="checkmark"
                  size={18}
                  color="#007AFF"
                  modifiers={[font({ weight: 'semibold' }), padding()]}
                />
              </SwiftUIButton>,
            ]}
          >
            <IosSheetForm>
              <Section title={t('filter.section.kind')}>
                {HISTORY_FILTER_KIND_OPTIONS.map((kind) => (
                  <SwiftUIButton
                    key={kind}
                    onPress={() => onToggleKind(kind)}
                    modifiers={[buttonStyle('plain')]}
                  >
                    <HStack
                      spacing={10}
                      alignment="center"
                      modifiers={[frame({ maxWidth: Infinity })]}
                    >
                      <Label
                        title={getDisplayKindLabel(kind)}
                        icon={
                          <Image
                            systemName={DISPLAY_KIND_SYMBOLS[kind]}
                            size={20}
                            color={DISPLAY_KIND_COLORS[kind]}
                          />
                        }
                      />
                      <Spacer />
                      {selectedKinds.includes(kind) ? (
                        <Image systemName="checkmark" size={17} color="#007AFF" />
                      ) : null}
                    </HStack>
                  </SwiftUIButton>
                ))}
              </Section>

              <Section title={t('filter.section.date')}>
                {getHistoryFilterDateOptions().map((option) => (
                  <SwiftUIButton
                    key={option.value}
                    onPress={() => onSelectDate(option.value)}
                    modifiers={[buttonStyle('plain')]}
                  >
                    <HStack alignment="center" modifiers={[frame({ maxWidth: Infinity })]}>
                      <SwiftUIText>{option.label}</SwiftUIText>
                      <Spacer />
                      {selectedDate === option.value ? (
                        <Image systemName="checkmark" size={17} color="#007AFF" />
                      ) : null}
                    </HStack>
                  </SwiftUIButton>
                ))}
              </Section>
            </IosSheetForm>
          </IosSheetPage>
        </Group>
      </BottomSheet>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', bottom: 0, left: 0, width: 1, height: 1 },
});
