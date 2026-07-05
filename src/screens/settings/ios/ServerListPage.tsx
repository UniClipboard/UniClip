import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button as SwiftUIButton,
  HStack,
  Image,
  Label,
  LabeledContent,
  Section,
  Spacer,
  Text as SwiftUIText,
  VStack,
} from '@expo/ui/swift-ui';
import {
  contentShape,
  foregroundStyle,
  frame,
  onTapGesture,
  shapes,
} from '@expo/ui/swift-ui/modifiers';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import { useSettingsStore } from '@/stores';
import type { ServerConfig } from '@/types/api';
import { chevronColor, HeaderCircleButton, SettingsToggle } from './common';

function getServerDisplayName(config: ServerConfig): string {
  if (config.name) return config.name;
  try {
    return new URL(config.url).hostname;
  } catch {
    return config.url;
  }
}

function getServerAddressCount(config: ServerConfig): number {
  return config.urls && config.urls.length > 0 ? config.urls.length : 1;
}

export function ServerListPage({
  onBack,
  onAddServer,
  onEditServer,
}: {
  onBack: () => void;
  onAddServer: () => void;
  onEditServer: (index: number) => void;
}) {
  const { t } = useTranslation('settingsIos');
  const { config, updateConfig } = useSettingsStore();
  if (!config) return null;

  const servers = config.servers ?? [];

  return (
    <IosSheetPage
      title={t('serverList.title')}
      leftSlots={[<HeaderCircleButton key="back" systemName="chevron.left" onPress={onBack} />]}
      rightSlots={[<HeaderCircleButton key="add" systemName="plus" onPress={onAddServer} />]}
    >
      <IosSheetForm>
        <Section footer={<SwiftUIText>{t('serverList.footer')}</SwiftUIText>}>
          {servers.length === 0 ? (
            <LabeledContent
              label={<Label title={t('serverList.empty.label')} systemImage="server.rack" />}
            >
              <SwiftUIButton
                systemImage="plus.circle"
                label={t('serverList.addShort')}
                onPress={onAddServer}
              />
            </LabeledContent>
          ) : (
            servers.map((server, index) => {
              const isActive = index === config.activeServerIndex;
              return (
                <HStack
                  key={`${server.url}-${index}`}
                  spacing={10}
                  modifiers={[
                    frame({ maxWidth: Infinity }),
                    contentShape(shapes.rectangle()),
                    onTapGesture(() => onEditServer(index)),
                  ]}
                >
                  <Label
                    title={getServerDisplayName(server)}
                    systemImage={isActive ? 'checkmark.circle.fill' : 'server.rack'}
                  />
                  <Spacer />
                  <VStack alignment="trailing" spacing={2}>
                    <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                      {t('serverList.addressCount', { count: getServerAddressCount(server) })}
                    </SwiftUIText>
                    <SwiftUIText
                      modifiers={[foregroundStyle({ type: 'hierarchical', style: 'tertiary' })]}
                    >
                      {server.url}
                    </SwiftUIText>
                  </VStack>
                  <Image systemName="chevron.right" size={12} color={chevronColor} />
                </HStack>
              );
            })
          )}
        </Section>

        {servers.length > 0 && (
          <Section>
            <SwiftUIButton
              systemImage="plus.circle"
              label={t('serverList.addServer')}
              onPress={onAddServer}
            />
          </Section>
        )}

        {/* ── 连接 ── */}
        <Section
          header={<SwiftUIText>{t('serverList.connection.title')}</SwiftUIText>}
          footer={<SwiftUIText>{t('serverList.connection.footer')}</SwiftUIText>}
        >
          <SettingsToggle
            label={t('serverList.connection.allowInsecure')}
            systemImage="lock.open"
            isOn={config.trustInsecureCert}
            onIsOnChange={(v) => updateConfig({ trustInsecureCert: v })}
          />
        </Section>
      </IosSheetForm>
    </IosSheetPage>
  );
}
