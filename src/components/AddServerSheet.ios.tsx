import React, { useState } from 'react';
import {
  Host,
  BottomSheet,
  Group,
  Form,
  Section,
  VStack,
  HStack,
  Text as SwiftUIText,
  Spacer,
  Button as SwiftUIButton,
  Image,
  TextField,
  SecureField,
  Toggle,
} from '@expo/ui/swift-ui';
import {
  presentationDetents,
  presentationDragIndicator,
  font,
  foregroundColor,
  frame,
  buttonStyle,
  listStyle,
  textFieldStyle,
  opacity,
} from '@expo/ui/swift-ui/modifiers';
import { SheetHeader } from '@/components/ui';
import type { AddServerSheetProps } from './AddServerSheet.types';

export function AddServerSheet({ visible, onClose, onSave }: AddServerSheetProps) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [trustInsecure, setTrustInsecure] = useState(false);

  const canSave = url.trim().length > 0;

  const handleSave = () => {
    onSave?.({ name, url: url.trim(), username: username.trim(), password: password.trim() });
  };

  return (
    <Host style={{ position: 'absolute', bottom: 0, left: 0, width: 1, height: 1 }}>
      <BottomSheet
        isPresented={visible}
        onIsPresentedChange={(presented) => { if (!presented) onClose(); }}
      >
        <Group modifiers={[
          presentationDetents(['large']),
          presentationDragIndicator('visible'),
        ]}>
          <VStack modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
            <SheetHeader
              title="Add Server"
              left={
                <SwiftUIButton onPress={onClose} modifiers={[buttonStyle('glass')]}>
                  <SwiftUIText modifiers={[font({ size: 16 })]}>Cancel</SwiftUIText>
                </SwiftUIButton>
              }
              right={
                <SwiftUIButton onPress={handleSave} modifiers={[buttonStyle('glass'), opacity(canSave ? 1 : 0.35)]}>
                  <SwiftUIText modifiers={[font({ weight: 'semibold', size: 16 })]}>Save</SwiftUIText>
                </SwiftUIButton>
              }
            />

            {/* Form */}
            <Form modifiers={[listStyle('insetGrouped')]}>
              {/* Scan QR */}
              <Section
                footer={<SwiftUIText>扫描桌面端的二维码，一键填充以下信息。</SwiftUIText>}
              >
                <SwiftUIButton systemImage="qrcode.viewfinder" label="扫码连接" onPress={() => {}} />
              </Section>

              {/* Name */}
              <Section
                title="Name"
                footer={<SwiftUIText>Shown on the Clipboard toolbar. Falls back to the server address when left blank.</SwiftUIText>}
              >
                <HStack>
                  <TextField
                    placeholder="Server name"
                    onTextChange={setName}
                    modifiers={[textFieldStyle('plain')]}
                  />
                  <SwiftUIButton onPress={() => {}} modifiers={[buttonStyle('plain')]}>
                    <Image systemName="shuffle" size={18} color="#8E8E93" />
                  </SwiftUIButton>
                </HStack>
              </Section>

              {/* Server Address */}
              <Section
                title="Server Address"
                footer={<SwiftUIText>One server can have several addresses (LAN / Tailscale / Internet); the app automatically uses whichever is reachable on the current network, with the first entry as the default. Swipe left to delete. "Allow Insecure Certificates" is only needed for self-signed HTTPS certificates — plain HTTP doesn't need it; the setting applies globally.</SwiftUIText>}
              >
                <TextField
                  placeholder="https://your-server.com:5033/"
                  onTextChange={setUrl}
                  modifiers={[textFieldStyle('plain'), foregroundColor('#007AFF')]}
                />
                <SwiftUIButton systemImage="plus.circle" label="Add Alternate Address" onPress={() => {}} />
                <Toggle
                  label="Trust Insecure Certificate"
                  isOn={trustInsecure}
                  onIsOnChange={setTrustInsecure}
                />
              </Section>

              {/* Credentials */}
              <Section title="Credentials">
                <TextField
                  placeholder="Username"
                  onTextChange={setUsername}
                  modifiers={[textFieldStyle('plain')]}
                />
                <SecureField
                  placeholder="Password"
                  onTextChange={setPassword}
                />
              </Section>
            </Form>
          </VStack>
        </Group>
      </BottomSheet>
    </Host>
  );
}
