import React from 'react';
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
  const { config, updateConfig } = useSettingsStore();
  if (!config) return null;

  const servers = config.servers ?? [];

  return (
    <IosSheetPage
      title="服务器"
      leftSlots={[<HeaderCircleButton key="back" systemName="chevron.left" onPress={onBack} />]}
      rightSlots={[<HeaderCircleButton key="add" systemName="plus" onPress={onAddServer} />]}
    >
      <IosSheetForm>
        <Section
          footer={
            <SwiftUIText>
              点选一台服务器可编辑地址、名称和凭据。新增服务器后会出现在此列表。
            </SwiftUIText>
          }
        >
          {servers.length === 0 ? (
            <LabeledContent label={<Label title="还没有服务器" systemImage="server.rack" />}>
              <SwiftUIButton systemImage="plus.circle" label="新增" onPress={onAddServer} />
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
                      {getServerAddressCount(server)} 个地址
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
            <SwiftUIButton systemImage="plus.circle" label="新增服务器" onPress={onAddServer} />
          </Section>
        )}

        {/* ── 连接 ── */}
        <Section
          header={<SwiftUIText>连接</SwiftUIText>}
          footer={
            <SwiftUIText>
              「允许不安全证书」仅在服务器使用自签名 HTTPS 证书时需要，纯 HTTP 无需开启。
            </SwiftUIText>
          }
        >
          <SettingsToggle
            label="允许不安全证书"
            systemImage="lock.open"
            isOn={config.trustInsecureCert}
            onIsOnChange={(v) => updateConfig({ trustInsecureCert: v })}
          />
        </Section>
      </IosSheetForm>
    </IosSheetPage>
  );
}
