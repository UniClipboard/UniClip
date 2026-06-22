import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
} from 'react-native';
import {
  Host,
  OutlinedTextField,
  AlertDialog,
  TextButton,
  Text as ComposeText,
  useNativeState,
} from '@expo/ui/jetpack-compose';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import { spacing, radius, typography } from '@/theme';
import { useSettingsStore } from '@/stores';
import { usePendingConnectStore } from '@/stores';
import { probe, type ProbeResult } from 'uc-core';
import { classifyURL, getURLClassDisplay, type ServerURLClass } from '@/utils/classifyUrl';
import { QrScannerModal } from './QrScannerModal';
import type { AddServerSheetProps } from './AddServerSheet.types';

const PROBE_STATUS_COLORS: Record<ProbeResult, string> = {
  Success: '#4CAF50',
  AuthFailed: '#F44336',
  Unreachable: '#FF9800',
  MissingFields: '#9E9E9E',
};

const PROBE_STATUS_ICONS: Record<ProbeResult, React.ComponentProps<typeof Ionicons>['name']> = {
  Success: 'checkmark-circle',
  AuthFailed: 'lock-closed',
  Unreachable: 'close-circle',
  MissingFields: 'ellipse-outline',
};

function URLClassBadge({ urlClass }: { urlClass: ServerURLClass }) {
  const { theme } = useTheme();
  const meta = getURLClassDisplay(urlClass);
  return (
    <View style={[badgeStyles.container, { backgroundColor: theme.colors.surfaceContainerHigh }]}>
      <Text style={[badgeStyles.text, { color: theme.colors.onSurfaceVariant }]}>
        {meta.label}
      </Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  text: {
    fontSize: 11,
    fontWeight: '500',
  },
});

function URLField({
  value,
  onChange,
  onRemove,
  canRemove,
  formKey,
  index,
}: {
  value: string;
  onChange: (text: string) => void;
  onRemove: () => void;
  canRemove: boolean;
  formKey: number;
  index: number;
}) {
  const { theme } = useTheme();
  const nativeState = useNativeState(value);

  const fieldColors = {
    focusedContainerColor: 'transparent',
    unfocusedContainerColor: 'transparent',
    focusedIndicatorColor: theme.colors.primary,
    unfocusedIndicatorColor: theme.colors.outlineVariant,
    focusedTextColor: theme.colors.onSurface,
    unfocusedTextColor: theme.colors.onSurface,
    focusedPlaceholderColor: theme.colors.onSurfaceVariant,
    unfocusedPlaceholderColor: theme.colors.onSurfaceVariant,
    focusedLabelColor: theme.colors.primary,
    unfocusedLabelColor: theme.colors.onSurfaceVariant,
    cursorColor: theme.colors.primary,
  };

  const trimmed = value.trim();
  let urlClass: ServerURLClass | null = null;
  if (trimmed) {
    try {
      new URL(trimmed);
      urlClass = classifyURL(trimmed);
    } catch {}
  }

  return (
    <View style={urlFieldStyles.row}>
      <View style={urlFieldStyles.fieldWrapper}>
        <Host matchContents style={urlFieldStyles.fieldHost}>
          <OutlinedTextField
            key={`url-${formKey}-${index}`}
            value={nativeState}
            onValueChange={onChange}
            keyboardOptions={{
              keyboardType: 'uri',
              capitalization: 'none',
              autoCorrectEnabled: false,
            }}
            singleLine
            modifiers={[fillMaxWidth()]}
            colors={fieldColors}
          >
            <OutlinedTextField.Placeholder>
              <ComposeText>https://your-server.com:5033/</ComposeText>
            </OutlinedTextField.Placeholder>
          </OutlinedTextField>
        </Host>
        <View style={urlFieldStyles.trailingRow}>
          {urlClass && <URLClassBadge urlClass={urlClass} />}
          {canRemove && (
            <Pressable onPress={onRemove} hitSlop={8}>
              <Ionicons name="remove-circle" size={20} color={theme.colors.error} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const urlFieldStyles = StyleSheet.create({
  row: { marginBottom: 4 },
  fieldWrapper: { position: 'relative' },
  fieldHost: { paddingHorizontal: 4 },
  trailingRow: {
    position: 'absolute',
    right: 8,
    top: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});

export function AddServerSheet({ visible, onClose, onSave }: AddServerSheetProps) {
  const { theme } = useTheme();
  const consumePendingConnect = usePendingConnectStore((s) => s.consume);
  const settings = useSettingsStore((s) => s.config);

  const [formKey, setFormKey] = useState(0);
  const [name, setName] = useState('');
  const [urls, setUrls] = useState<string[]>(['']);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string } | null>(null);

  const [isProbing, setIsProbing] = useState(false);
  const [probeResults, setProbeResults] = useState<Record<string, ProbeResult> | null>(null);

  const nameNativeState = useNativeState(name);
  const usernameNativeState = useNativeState(username);
  const passwordNativeState = useNativeState(password);

  const trustInsecureCert = settings?.trustInsecureCert ?? false;

  const cleanedUrls = useMemo(() => {
    const seen = new Set<string>();
    return urls
      .map((u) => u.trim())
      .filter((u) => u.length > 0 && seen.add(u));
  }, [urls]);

  const canSave =
    cleanedUrls.length > 0 &&
    username.trim().length > 0 &&
    password.trim().length > 0;

  useEffect(() => {
    if (visible) {
      setName('');
      setUrls(['']);
      setUsername('');
      setPassword('');
      setProbeResults(null);
      setIsProbing(false);
      setAlertInfo(null);
      setFormKey((k) => k + 1);
    }
  }, [visible]);

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
    setFormKey((k) => k + 1);
  }, []);

  const removeUrl = useCallback((index: number) => {
    setUrls((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length === 0 ? [''] : next;
    });
    setProbeResults(null);
    setFormKey((k) => k + 1);
  }, []);

  const handleProbe = useCallback(async () => {
    if (cleanedUrls.length === 0) {
      setAlertInfo({ title: '提示', message: '请先填写至少一个服务器地址。' });
      return;
    }
    if (!username.trim() || !password.trim()) {
      setAlertInfo({ title: '提示', message: '请先填写用户名和密码。' });
      return;
    }

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
    if (!canSave) {
      setAlertInfo({ title: '提示', message: '请填写服务器地址、用户名和密码。' });
      return;
    }
    try {
      new URL(cleanedUrls[0]);
    } catch {
      setAlertInfo({ title: '错误', message: '服务器地址格式不正确。' });
      return;
    }
    onSave({
      name: name.trim(),
      urls: cleanedUrls,
      username: username.trim(),
      password: password.trim(),
    });
    onClose();
  }, [canSave, name, cleanedUrls, username, password, onSave, onClose]);

  const handleScanComplete = useCallback(() => {
    setShowScanner(false);
    const intent = consumePendingConnect();
    if (intent) {
      if (intent.urls && intent.urls.length > 0) {
        setUrls(intent.urls);
      } else if (intent.url) {
        setUrls([intent.url]);
      }
      if (intent.user) setUsername(intent.user);
      if (intent.pwd) setPassword(intent.pwd);
      if (intent.label) setName(intent.label);
      setProbeResults(null);
      setFormKey((k) => k + 1);
    }
  }, [consumePendingConnect]);

  const fieldColors = {
    focusedContainerColor: 'transparent',
    unfocusedContainerColor: 'transparent',
    focusedIndicatorColor: theme.colors.primary,
    unfocusedIndicatorColor: theme.colors.outlineVariant,
    focusedTextColor: theme.colors.onSurface,
    unfocusedTextColor: theme.colors.onSurface,
    focusedPlaceholderColor: theme.colors.onSurfaceVariant,
    unfocusedPlaceholderColor: theme.colors.onSurfaceVariant,
    focusedLabelColor: theme.colors.primary,
    unfocusedLabelColor: theme.colors.onSurfaceVariant,
    cursorColor: theme.colors.primary,
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <KeyboardAvoidingView style={styles.flex} behavior="height">
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: theme.colors.outlineVariant }]}>
            <Pressable onPress={onClose} style={styles.headerBtn}>
              <Text style={[styles.headerBtnText, { color: theme.colors.primary }]}>取消</Text>
            </Pressable>
            <Text style={[styles.headerTitle, { color: theme.colors.onSurface }]}>添加服务器</Text>
            <Pressable onPress={handleSave} disabled={!canSave} style={styles.headerBtn}>
              <Text
                style={[
                  styles.headerBtnText,
                  styles.headerBtnBold,
                  { color: canSave ? theme.colors.primary : theme.colors.outline },
                ]}
              >
                保存
              </Text>
            </Pressable>
          </View>

          <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            {/* § 扫码 */}
            <View style={styles.section}>
              <Pressable
                onPress={() => setShowScanner(true)}
                style={[styles.scanRow, { backgroundColor: theme.colors.surfaceContainerLow }]}
              >
                <Ionicons name="qr-code-outline" size={20} color={theme.colors.primary} />
                <Text style={[styles.scanLabel, { color: theme.colors.primary }]}>扫码连接</Text>
                <Ionicons name="chevron-forward" size={16} color={theme.colors.outline} />
              </Pressable>
              <Text style={[styles.sectionFooter, { color: theme.colors.onSurfaceVariant }]}>
                扫描桌面端的二维码，一键填充以下信息。
              </Text>
            </View>

            {/* § 名称 */}
            <View style={styles.section}>
              <Text style={[styles.sectionHeader, { color: theme.colors.onSurfaceVariant }]}>名称</Text>
              <Host matchContents style={styles.fieldHost}>
                <OutlinedTextField
                  key={`name-${formKey}`}
                  value={nameNativeState}
                  onValueChange={setName}
                  keyboardOptions={{ capitalization: 'none', autoCorrectEnabled: false }}
                  singleLine
                  modifiers={[fillMaxWidth()]}
                  colors={fieldColors}
                >
                  <OutlinedTextField.Placeholder>
                    <ComposeText>便于辨识的名称</ComposeText>
                  </OutlinedTextField.Placeholder>
                </OutlinedTextField>
              </Host>
              <Text style={[styles.sectionFooter, { color: theme.colors.onSurfaceVariant }]}>
                将显示在剪贴板顶栏。留空会用服务器地址替代。
              </Text>
            </View>

            {/* § 服务器地址（多地址） */}
            <View style={styles.section}>
              <Text style={[styles.sectionHeader, { color: theme.colors.onSurfaceVariant }]}>服务器地址</Text>
              {urls.map((url, i) => (
                <URLField
                  key={`urlfield-${formKey}-${i}`}
                  value={url}
                  onChange={(text) => updateUrl(i, text)}
                  onRemove={() => removeUrl(i)}
                  canRemove={urls.length > 1}
                  formKey={formKey}
                  index={i}
                />
              ))}
              <Pressable
                onPress={addUrl}
                style={[styles.addUrlRow, { backgroundColor: theme.colors.surfaceContainerLow }]}
              >
                <Ionicons name="add-circle-outline" size={18} color={theme.colors.primary} />
                <Text style={[styles.addUrlText, { color: theme.colors.primary }]}>添加备用地址</Text>
              </Pressable>
              <Text style={[styles.sectionFooter, { color: theme.colors.onSurfaceVariant }]}>
                同一服务器可填多个地址（局域网 / Tailscale / 公网），App 会按当前网络自动选用可达的一条；第一条为默认地址。
              </Text>
            </View>

            {/* § 凭据 */}
            <View style={styles.section}>
              <Text style={[styles.sectionHeader, { color: theme.colors.onSurfaceVariant }]}>凭据</Text>
              <Host matchContents style={styles.fieldHost}>
                <OutlinedTextField
                  key={`username-${formKey}`}
                  value={usernameNativeState}
                  onValueChange={(v) => {
                    setUsername(v);
                    setProbeResults(null);
                  }}
                  keyboardOptions={{ capitalization: 'none', autoCorrectEnabled: false }}
                  singleLine
                  modifiers={[fillMaxWidth()]}
                  colors={fieldColors}
                >
                  <OutlinedTextField.Placeholder>
                    <ComposeText>用户名</ComposeText>
                  </OutlinedTextField.Placeholder>
                </OutlinedTextField>
              </Host>
              <View style={{ height: 8 }} />
              <Host matchContents style={styles.fieldHost}>
                <OutlinedTextField
                  key={`password-${formKey}`}
                  value={passwordNativeState}
                  onValueChange={(v) => {
                    setPassword(v);
                    setProbeResults(null);
                  }}
                  keyboardOptions={{
                    keyboardType: 'password',
                    capitalization: 'none',
                    autoCorrectEnabled: false,
                    imeAction: 'done',
                  }}
                  singleLine
                  modifiers={[fillMaxWidth()]}
                  colors={fieldColors}
                >
                  <OutlinedTextField.Placeholder>
                    <ComposeText>密码</ComposeText>
                  </OutlinedTextField.Placeholder>
                </OutlinedTextField>
              </Host>
            </View>

            {/* § 连接测试 */}
            <View style={styles.section}>
              <Text style={[styles.sectionHeader, { color: theme.colors.onSurfaceVariant }]}>连接</Text>

              {probeResults && cleanedUrls.map((u) => {
                const result = probeResults[u];
                const cls = classifyURL(u);
                const isPicked = u === pickedUrl;
                const statusColor = result ? PROBE_STATUS_COLORS[result] : '#9E9E9E';
                const statusIcon = result ? PROBE_STATUS_ICONS[result] : 'ellipse-outline';
                return (
                  <View
                    key={`probe-${u}`}
                    style={[
                      styles.probeRow,
                      {
                        backgroundColor:
                          result === 'Success'
                            ? 'rgba(76,175,80,0.08)'
                            : result === 'AuthFailed'
                              ? 'rgba(244,67,54,0.08)'
                              : result === 'Unreachable'
                                ? 'rgba(255,152,0,0.08)'
                                : 'rgba(158,158,158,0.08)',
                      },
                    ]}
                  >
                    <Ionicons name={statusIcon} size={18} color={statusColor} />
                    <View style={styles.probeInfo}>
                      <Text
                        style={[styles.probeUrl, { color: theme.colors.onSurface }]}
                        numberOfLines={1}
                      >
                        {u}
                      </Text>
                      <View style={styles.probeLabels}>
                        <URLClassBadge urlClass={cls} />
                        {isPicked && (
                          <Text style={styles.pickedLabel}>将使用</Text>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })}

              <Pressable
                onPress={handleProbe}
                disabled={isProbing}
                style={[
                  styles.testButton,
                  {
                    backgroundColor: isProbing
                      ? theme.colors.surfaceContainerHigh
                      : theme.colors.surfaceContainerLow,
                  },
                ]}
              >
                {isProbing ? (
                  <>
                    <Ionicons name="hourglass-outline" size={18} color={theme.colors.onSurfaceVariant} />
                    <Text style={[styles.testButtonText, { color: theme.colors.onSurfaceVariant }]}>
                      正在测试…
                    </Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="flash-outline" size={18} color={theme.colors.primary} />
                    <Text style={[styles.testButtonText, { color: theme.colors.primary }]}>
                      {probeResults ? '重新测试' : '测试连接'}
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>

        {alertInfo && (
          <Host>
            <AlertDialog onDismissRequest={() => setAlertInfo(null)}>
              <AlertDialog.Title>
                <ComposeText>{alertInfo.title}</ComposeText>
              </AlertDialog.Title>
              <AlertDialog.Text>
                <ComposeText>{alertInfo.message}</ComposeText>
              </AlertDialog.Text>
              <AlertDialog.ConfirmButton>
                <TextButton onClick={() => setAlertInfo(null)}>
                  <ComposeText>确定</ComposeText>
                </TextButton>
              </AlertDialog.ConfirmButton>
            </AlertDialog>
          </Host>
        )}
      </SafeAreaView>

      <QrScannerModal
        visible={showScanner}
        onClose={() => setShowScanner(false)}
        onScanned={handleScanComplete}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: { paddingVertical: 4, paddingHorizontal: 4, minWidth: 50 },
  headerBtnText: { fontSize: 16 },
  headerBtnBold: { fontWeight: '600' },
  headerTitle: { fontSize: 16, fontWeight: '600' },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  section: { marginTop: 24, paddingHorizontal: 16 },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sectionFooter: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 6,
    paddingHorizontal: 4,
  },
  scanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
  },
  scanLabel: { flex: 1, fontSize: 15, fontWeight: '500' },
  fieldHost: { paddingHorizontal: 4 },
  addUrlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 4,
  },
  addUrlText: { fontSize: 14, fontWeight: '500' },
  probeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 6,
  },
  probeInfo: { flex: 1, gap: 2 },
  probeUrl: { fontSize: 13 },
  probeLabels: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pickedLabel: { fontSize: 11, fontWeight: '600', color: '#4CAF50' },
  testButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  testButtonText: { fontSize: 15, fontWeight: '500' },
});
