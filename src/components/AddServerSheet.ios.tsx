import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Alert } from 'react-native';
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
  ProgressView,
  type TextFieldRef,
} from '@expo/ui/swift-ui';
import {
  presentationDetents,
  presentationDragIndicator,
  font,
  foregroundStyle,
  foregroundColor,
  frame,
  buttonStyle,
  listStyle,
  textFieldStyle,
  opacity,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { SheetHeader } from '@/components/ui';
import { iosAccentColor } from '@/theme/iosDesignTokens';
import { useSettingsStore } from '@/stores';
import { probe, type ProbeResult } from 'uc-core';
import { scanQRCode } from 'qr-scanner';
import { parseConnectUri, CONNECT_URI_ERROR_MESSAGES } from '@/utils/connectUri';
import {
  classifyURL,
  getURLClassDisplay,
  URL_CLASS_ICONS,
  type ServerURLClass,
} from '@/utils/classifyUrl';
import type { SFSymbol } from 'sf-symbols-typescript';
import type { AddServerSheetProps } from './AddServerSheet.types';

const PROBE_STATUS: Record<ProbeResult, { icon: string; color: string }> = {
  Success: { icon: 'checkmark.circle.fill', color: '#34C759' },
  AuthFailed: { icon: 'lock.trianglebadge.exclamationmark.fill', color: '#FF3B30' },
  Unreachable: { icon: 'xmark.circle', color: '#FF9500' },
  MissingFields: { icon: 'circle.dotted', color: '#8E8E93' },
};

function URLClassChip({ urlClass }: { urlClass: ServerURLClass }) {
  const meta = getURLClassDisplay(urlClass);
  return (
    <HStack spacing={3}>
      <Image systemName={URL_CLASS_ICONS[urlClass]} size={10} color="#8E8E93" />
      <SwiftUIText modifiers={[font({ size: 11 }), foregroundStyle('#8E8E93')]}>
        {meta.label}
      </SwiftUIText>
    </HStack>
  );
}

function ProbeStatusIcon({ result }: { result?: ProbeResult }) {
  if (!result) {
    return <Image systemName="circle.dotted" size={16} color="#8E8E93" />;
  }
  const s = PROBE_STATUS[result];
  return <Image systemName={s.icon as SFSymbol} size={16} color={s.color} />;
}

export function AddServerSheet({
  visible,
  title = '添加服务器',
  initialData,
  onClose,
  onSave,
}: AddServerSheetProps) {
  const [name, setName] = useState('');
  const [urls, setUrls] = useState<string[]>(['']);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const { config, updateConfig } = useSettingsStore();
  const trustInsecureCert = config?.trustInsecureCert ?? false;

  const [isProbing, setIsProbing] = useState(false);
  const [probeResults, setProbeResults] = useState<Record<string, ProbeResult> | null>(null);

  const urlRefs = useRef<(TextFieldRef | null)[]>([]);
  const nameRef = useRef<TextFieldRef | null>(null);
  const usernameRef = useRef<TextFieldRef | null>(null);
  const passwordRef = useRef<TextFieldRef | null>(null);

  useEffect(() => {
    if (!visible) return;

    const nextName = initialData?.name ?? '';
    const nextUrls = initialData?.urls && initialData.urls.length > 0 ? initialData.urls : [''];
    const nextUsername = initialData?.username ?? '';
    const nextPassword = initialData?.password ?? '';

    setName(nextName);
    setUrls(nextUrls);
    setUsername(nextUsername);
    setPassword(nextPassword);
    setProbeResults(null);
    setIsProbing(false);

    setTimeout(() => {
      nameRef.current?.setText(nextName);
      nextUrls.forEach((u, i) => urlRefs.current[i]?.setText(u));
      usernameRef.current?.setText(nextUsername);
      passwordRef.current?.setText(nextPassword);
    }, 0);
  }, [visible, initialData]);

  const cleanedUrls = useMemo(() => {
    const seen = new Set<string>();
    return urls.map((u) => u.trim()).filter((u) => u.length > 0 && seen.add(u));
  }, [urls]);

  const canSave =
    cleanedUrls.length > 0 && username.trim().length > 0 && password.trim().length > 0;

  const updateUrl = useCallback((index: number, text: string) => {
    setUrls((prev) => {
      if (index >= prev.length) return prev;
      const next = [...prev];
      next[index] = text;
      return next;
    });
    setProbeResults(null);
  }, []);

  const addUrl = useCallback(() => {
    setUrls((prev) => [...prev, '']);
  }, []);

  const removeUrl = useCallback((index: number) => {
    setUrls((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length === 0 ? [''] : next;
    });
    setProbeResults(null);
  }, []);

  const handleProbe = useCallback(async () => {
    if (cleanedUrls.length === 0) return;
    setIsProbing(true);
    setProbeResults(null);
    try {
      const report = await probe(
        cleanedUrls,
        username.trim(),
        password.trim(),
        trustInsecureCert,
        3000,
        0
      );
      setProbeResults(report.results);
    } catch {
      const fallback: Record<string, ProbeResult> = {};
      for (const u of cleanedUrls) fallback[u] = 'Unreachable';
      setProbeResults(fallback);
    } finally {
      setIsProbing(false);
    }
  }, [cleanedUrls, username, password, trustInsecureCert]);

  const pickedUrl = useMemo(() => {
    if (!probeResults) return null;
    for (const u of cleanedUrls) {
      const r = probeResults[u];
      if (r === 'Success' || r === 'AuthFailed') return u;
    }
    return null;
  }, [probeResults, cleanedUrls]);

  const handleSave = useCallback(() => {
    if (!canSave) return;
    onSave({
      name: name.trim(),
      urls: cleanedUrls,
      username: username.trim(),
      password: password.trim(),
    });
    onClose();
  }, [canSave, name, cleanedUrls, username, password, onSave, onClose]);

  const handleClose = useCallback(() => {
    setName('');
    setUrls(['']);
    setUsername('');
    setPassword('');
    setProbeResults(null);
    setIsProbing(false);
    onClose();
  }, [onClose]);

  const handleScan = useCallback(async () => {
    try {
      const raw = await scanQRCode();
      if (!raw) return;

      const parsed = parseConnectUri(raw);
      if (!parsed.ok) {
        Alert.alert('扫码失败', CONNECT_URI_ERROR_MESSAGES[parsed.error]);
        return;
      }

      const scannedUrls = parsed.value.urls.length > 0 ? parsed.value.urls : [parsed.value.url];
      setUrls(scannedUrls);
      setUsername(parsed.value.user);
      setPassword(parsed.value.pwd);
      if (parsed.value.label) setName(parsed.value.label);
      setProbeResults(null);

      setTimeout(() => {
        scannedUrls.forEach((u, i) => urlRefs.current[i]?.setText(u));
        usernameRef.current?.setText(parsed.value.user);
        passwordRef.current?.setText(parsed.value.pwd);
        if (parsed.value.label) nameRef.current?.setText(parsed.value.label);
      }, 300);
    } catch (e: unknown) {
      Alert.alert('扫码失败', e instanceof Error ? e.message : '未知错误');
    }
  }, []);

  const classForUrl = useCallback((u: string): ServerURLClass | null => {
    const trimmed = u.trim();
    if (!trimmed) return null;
    try {
      new URL(trimmed);
      return classifyURL(trimmed);
    } catch {
      return null;
    }
  }, []);

  const probeErrorMessage = useMemo(() => {
    if (!probeResults) return null;
    const values = Object.values(probeResults);
    if (values.every((r) => r === 'Unreachable'))
      return '所有地址均不可达，请检查网络或服务器地址。';
    if (values.some((r) => r === 'AuthFailed') && !values.some((r) => r === 'Success'))
      return '认证失败，请检查用户名和密码。';
    return null;
  }, [probeResults]);

  return (
    <Host style={{ position: 'absolute', bottom: 0, left: 0, width: 1, height: 1 }}>
      <BottomSheet
        isPresented={visible}
        onIsPresentedChange={(presented) => {
          if (!presented) handleClose();
        }}
      >
        <Group modifiers={[presentationDetents(['large']), presentationDragIndicator('visible')]}>
          <VStack
            modifiers={[
              frame({ maxWidth: Infinity, maxHeight: Infinity }),
              ...(iosAccentColor ? [tint(iosAccentColor)] : []),
            ]}
          >
            <SheetHeader
              title={title}
              left={
                <SwiftUIButton onPress={handleClose} modifiers={[buttonStyle('glass')]}>
                  <SwiftUIText modifiers={[font({ size: 16 })]}>取消</SwiftUIText>
                </SwiftUIButton>
              }
              right={
                <SwiftUIButton
                  onPress={handleSave}
                  modifiers={[buttonStyle('glass'), opacity(canSave ? 1 : 0.35)]}
                >
                  <SwiftUIText modifiers={[font({ weight: 'semibold', size: 16 })]}>
                    保存
                  </SwiftUIText>
                </SwiftUIButton>
              }
            />

            <Form modifiers={[listStyle('insetGrouped')]}>
              {/* ── 扫码 ── */}
              <Section footer={<SwiftUIText>扫描桌面端的二维码，一键填充以下信息。</SwiftUIText>}>
                <SwiftUIButton
                  systemImage="qrcode.viewfinder"
                  label="扫码连接"
                  onPress={handleScan}
                />
              </Section>

              {/* ── 名称 ── */}
              <Section
                title="名称"
                footer={<SwiftUIText>将显示在剪贴板顶栏。留空会用服务器地址替代。</SwiftUIText>}
              >
                <HStack>
                  <TextField
                    ref={nameRef}
                    placeholder="便于辨识的名称"
                    onTextChange={setName}
                    modifiers={[textFieldStyle('plain'), frame({ minHeight: 22 })]}
                  />
                  <SwiftUIButton onPress={() => {}} modifiers={[buttonStyle('plain')]}>
                    <Image systemName="shuffle" size={18} color="#8E8E93" />
                  </SwiftUIButton>
                </HStack>
              </Section>

              {/* ── 服务器地址（多地址） ── */}
              <Section
                title="服务器地址"
                footer={
                  <SwiftUIText>
                    同一服务器可填多个地址（局域网 / Tailscale / 公网），App
                    会按当前网络自动选用可达的一条；第一条为默认地址。
                  </SwiftUIText>
                }
              >
                {urls.map((url, i) => (
                  <HStack key={`url-row-${i}`} spacing={8}>
                    <TextField
                      ref={(r: TextFieldRef | null) => {
                        urlRefs.current[i] = r;
                      }}
                      placeholder="https://your-server.com:5033/"
                      onTextChange={(text: string) => updateUrl(i, text)}
                      modifiers={[
                        textFieldStyle('plain'),
                        foregroundColor('#007AFF'),
                        frame({ minHeight: 22 }),
                      ]}
                    />
                    {classForUrl(url) && <URLClassChip urlClass={classForUrl(url)!} />}
                    {urls.length > 1 && (
                      <SwiftUIButton
                        onPress={() => removeUrl(i)}
                        modifiers={[buttonStyle('plain')]}
                      >
                        <Image systemName="minus.circle.fill" size={18} color="#FF3B30" />
                      </SwiftUIButton>
                    )}
                  </HStack>
                ))}
                <SwiftUIButton systemImage="plus.circle" label="添加备用地址" onPress={addUrl} />
                <Toggle
                  label="允许不安全证书"
                  isOn={trustInsecureCert}
                  onIsOnChange={(v) => updateConfig({ trustInsecureCert: v })}
                />
              </Section>

              {/* ── 凭据 ── */}
              <Section title="凭据">
                <TextField
                  ref={usernameRef}
                  placeholder="用户名"
                  onTextChange={setUsername}
                  modifiers={[textFieldStyle('plain'), frame({ minHeight: 22 })]}
                />
                <SecureField
                  ref={passwordRef}
                  placeholder="密码"
                  onTextChange={setPassword}
                  modifiers={[frame({ minHeight: 22 })]}
                />
              </Section>

              {/* ── 测试连接 ── */}
              <Section
                title="连接"
                footer={
                  probeErrorMessage ? (
                    <SwiftUIText>{probeErrorMessage}</SwiftUIText>
                  ) : probeResults ? (
                    <SwiftUIText>
                      标注「将使用」的地址是当前网络下的首选；网络变化时会自动重选。
                    </SwiftUIText>
                  ) : undefined
                }
              >
                {probeResults &&
                  cleanedUrls.map((u) => {
                    const result = probeResults[u];
                    const cls = classifyURL(u);
                    const isPicked = u === pickedUrl;
                    return (
                      <HStack key={`probe-${u}`} spacing={8} alignment="center">
                        <VStack alignment="leading" spacing={2}>
                          <SwiftUIText modifiers={[font({ size: 14 })]}>{u}</SwiftUIText>
                          <HStack spacing={6}>
                            <URLClassChip urlClass={cls} />
                            {isPicked && (
                              <SwiftUIText
                                modifiers={[
                                  font({ weight: 'medium', size: 11 }),
                                  foregroundStyle('#34C759'),
                                ]}
                              >
                                将使用
                              </SwiftUIText>
                            )}
                          </HStack>
                        </VStack>
                        <Spacer />
                        <ProbeStatusIcon result={result} />
                      </HStack>
                    );
                  })}

                {isProbing ? (
                  <HStack
                    spacing={8}
                    alignment="center"
                    modifiers={[frame({ maxWidth: Infinity })]}
                  >
                    <ProgressView />
                    <SwiftUIText modifiers={[foregroundStyle('#8E8E93')]}>正在测试…</SwiftUIText>
                  </HStack>
                ) : (
                  <SwiftUIButton
                    systemImage="bolt.fill"
                    label={probeResults ? '重新测试' : '测试连接'}
                    onPress={handleProbe}
                  />
                )}
              </Section>
            </Form>
          </VStack>
        </Group>
      </BottomSheet>
    </Host>
  );
}
