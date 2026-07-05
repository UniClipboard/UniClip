import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMaterialColors } from '@expo/ui/jetpack-compose';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/stores';
import { usePendingConnectStore } from '@/stores';
import { probe, type ProbeResult } from 'uc-core';
import { classifyURL, getURLClassDisplay, type ServerURLClass } from '@/utils/classifyUrl';
import { QrScannerModal } from './QrScannerModal';
import type { AddServerSheetProps } from './AddServerSheet.types';

/**
 * 与设置页(@expo/ui Compose)同源的 Material You 动态色板,跟随 app 深浅色。
 * 本表单是纯 RN 组件,若用 @/theme 的静态 M3 baseline(紫色调),在启用动态取色的
 * 设备上会与周围设置页明显不一致。
 */
function useDynamicColors() {
  const { theme } = useTheme();
  return useMaterialColors({ colorScheme: theme.isDark ? 'dark' : 'light' });
}

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

function getProbeBackgroundColor(result?: ProbeResult): string {
  switch (result) {
    case 'Success':
      return 'rgba(76,175,80,0.08)';
    case 'AuthFailed':
      return 'rgba(244,67,54,0.08)';
    case 'Unreachable':
      return 'rgba(255,152,0,0.08)';
    default:
      return 'rgba(158,158,158,0.08)';
  }
}

function URLClassBadge({ urlClass }: { urlClass: ServerURLClass }) {
  const colors = useDynamicColors();
  const meta = getURLClassDisplay(urlClass);
  return (
    <View style={[badgeStyles.container, { backgroundColor: colors.surfaceContainerHigh }]}>
      <Text style={[badgeStyles.text, { color: colors.onSurfaceVariant }]}>{meta.label}</Text>
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

export function AddServerSheet({
  visible,
  title: titleProp,
  initialData,
  onClose,
  onSave,
}: AddServerSheetProps) {
  const { t } = useTranslation('server');
  const title = titleProp ?? t('sheet.addTitle');
  const colors = useDynamicColors();
  const consumePendingConnect = usePendingConnectStore((s) => s.consume);
  const settings = useSettingsStore((s) => s.config);

  const [name, setName] = useState('');
  const [urls, setUrls] = useState<string[]>(['']);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showScanner, setShowScanner] = useState(false);

  const [isProbing, setIsProbing] = useState(false);
  const [probeResults, setProbeResults] = useState<Record<string, ProbeResult> | null>(null);

  const trustInsecureCert = settings?.trustInsecureCert ?? false;

  const cleanedUrls = useMemo(() => {
    const seen = new Set<string>();
    return urls.map((u) => u.trim()).filter((u) => u.length > 0 && seen.add(u));
  }, [urls]);

  const canSave =
    cleanedUrls.length > 0 && username.trim().length > 0 && password.trim().length > 0;

  useEffect(() => {
    if (visible) {
      setName(initialData?.name ?? '');
      setUrls(initialData?.urls && initialData.urls.length > 0 ? initialData.urls : ['']);
      setUsername(initialData?.username ?? '');
      setPassword(initialData?.password ?? '');
      setProbeResults(null);
      setIsProbing(false);
    }
  }, [visible, initialData]);

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
    if (cleanedUrls.length === 0) {
      Alert.alert(t('alert.hintTitle'), t('alert.fillUrlFirst'));
      return;
    }
    if (!username.trim() || !password.trim()) {
      Alert.alert(t('alert.hintTitle'), t('alert.fillCredentialsFirst'));
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
  }, [cleanedUrls, username, password, trustInsecureCert, t]);

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
      Alert.alert(t('alert.hintTitle'), t('alert.fillAllFieldsDot'));
      return;
    }
    try {
      new URL(cleanedUrls[0]);
    } catch {
      Alert.alert(t('alert.errorTitle'), t('alert.invalidUrlDot'));
      return;
    }
    onSave({
      name: name.trim(),
      urls: cleanedUrls,
      username: username.trim(),
      password: password.trim(),
    });
    onClose();
  }, [canSave, name, cleanedUrls, username, password, onSave, onClose, t]);

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
    }
  }, [consumePendingConnect]);

  const inputStyle = [
    styles.input,
    {
      color: colors.onSurface,
      borderColor: colors.outlineVariant,
    },
  ];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <KeyboardAvoidingView style={styles.flex} behavior="height">
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.outlineVariant }]}>
            <Pressable onPress={onClose} style={styles.headerBtn}>
              <Text style={[styles.headerBtnText, { color: colors.primary }]}>
                {t('action.cancel', { ns: 'common' })}
              </Text>
            </Pressable>
            <Text style={[styles.headerTitle, { color: colors.onSurface }]}>{title}</Text>
            <Pressable onPress={handleSave} disabled={!canSave} style={styles.headerBtn}>
              <Text
                style={[
                  styles.headerBtnText,
                  styles.headerBtnBold,
                  { color: canSave ? colors.primary : colors.outline },
                ]}
              >
                {t('action.save', { ns: 'common' })}
              </Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* § 扫码 */}
            <View style={styles.section}>
              <Pressable
                onPress={() => setShowScanner(true)}
                style={[styles.scanRow, { backgroundColor: colors.surfaceContainerLow }]}
              >
                <Ionicons name="qr-code-outline" size={20} color={colors.primary} />
                <Text style={[styles.scanLabel, { color: colors.primary }]}>
                  {t('scan.action')}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.outline} />
              </Pressable>
              <Text style={[styles.sectionFooter, { color: colors.onSurfaceVariant }]}>
                {t('scan.footer')}
              </Text>
            </View>

            {/* § 名称 */}
            <View style={styles.section}>
              <Text style={[styles.sectionHeader, { color: colors.primary }]}>
                {t('form.nameLabel')}
              </Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={t('form.namePlaceholder')}
                placeholderTextColor={colors.onSurfaceVariant}
                autoCapitalize="none"
                autoCorrect={false}
                style={inputStyle}
              />
              <Text style={[styles.sectionFooter, { color: colors.onSurfaceVariant }]}>
                {t('form.nameFooter')}
              </Text>
            </View>

            {/* § 服务器地址（多地址） */}
            <View style={styles.section}>
              <Text style={[styles.sectionHeader, { color: colors.primary }]}>
                {t('form.urlLabel')}
              </Text>
              {urls.map((url, i) => {
                const trimmed = url.trim();
                let urlClass: ServerURLClass | null = null;
                if (trimmed) {
                  try {
                    new URL(trimmed);
                    urlClass = classifyURL(trimmed);
                  } catch {}
                }
                return (
                  <View key={`url-${i}`} style={styles.urlRow}>
                    <View style={styles.urlInputWrapper}>
                      <TextInput
                        value={url}
                        onChangeText={(text) => updateUrl(i, text)}
                        placeholder="https://your-server.com:5033/"
                        placeholderTextColor={colors.onSurfaceVariant}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                        style={[
                          inputStyle,
                          { paddingRight: urlClass || urls.length > 1 ? 80 : 16 },
                        ]}
                      />
                      <View style={styles.urlTrailing}>
                        {urlClass && <URLClassBadge urlClass={urlClass} />}
                        {urls.length > 1 && (
                          <Pressable onPress={() => removeUrl(i)} hitSlop={8}>
                            <Ionicons name="remove-circle" size={20} color={colors.error} />
                          </Pressable>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })}
              <Pressable
                onPress={addUrl}
                style={[styles.actionRow, { backgroundColor: colors.surfaceContainerLow }]}
              >
                <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
                <Text style={[styles.actionRowText, { color: colors.primary }]}>
                  {t('form.addBackupUrl')}
                </Text>
              </Pressable>
              <Text style={[styles.sectionFooter, { color: colors.onSurfaceVariant }]}>
                {t('form.urlFooter')}
              </Text>
            </View>

            {/* § 凭据 */}
            <View style={styles.section}>
              <Text style={[styles.sectionHeader, { color: colors.primary }]}>
                {t('form.credentialsLabel')}
              </Text>
              <TextInput
                value={username}
                onChangeText={(v) => {
                  setUsername(v);
                  setProbeResults(null);
                }}
                placeholder={t('form.usernamePlaceholder')}
                placeholderTextColor={colors.onSurfaceVariant}
                autoCapitalize="none"
                autoCorrect={false}
                style={inputStyle}
              />
              <View style={{ height: 10 }} />
              <TextInput
                value={password}
                onChangeText={(v) => {
                  setPassword(v);
                  setProbeResults(null);
                }}
                placeholder={t('form.passwordPlaceholder')}
                placeholderTextColor={colors.onSurfaceVariant}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                style={inputStyle}
              />
            </View>

            {/* § 连接测试 */}
            <View style={styles.section}>
              <Text style={[styles.sectionHeader, { color: colors.primary }]}>
                {t('connect.sectionLabel')}
              </Text>

              {probeResults &&
                cleanedUrls.map((u) => {
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
                          backgroundColor: getProbeBackgroundColor(result),
                        },
                      ]}
                    >
                      <Ionicons name={statusIcon} size={18} color={statusColor} />
                      <View style={styles.probeInfo}>
                        <Text
                          style={[styles.probeUrl, { color: colors.onSurface }]}
                          numberOfLines={1}
                        >
                          {u}
                        </Text>
                        <View style={styles.probeLabels}>
                          <URLClassBadge urlClass={cls} />
                          {isPicked && (
                            <Text style={styles.pickedLabel}>{t('connect.willUse')}</Text>
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
                  styles.actionRow,
                  {
                    backgroundColor: isProbing
                      ? colors.surfaceContainerHigh
                      : colors.surfaceContainerLow,
                    justifyContent: 'center',
                  },
                ]}
              >
                {isProbing ? (
                  <>
                    <ActivityIndicator size="small" color={colors.onSurfaceVariant} />
                    <Text style={[styles.actionRowText, { color: colors.onSurfaceVariant }]}>
                      {t('connect.testing')}
                    </Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="flash-outline" size={18} color={colors.primary} />
                    <Text style={[styles.actionRowText, { color: colors.primary }]}>
                      {probeResults ? t('connect.retest') : t('connect.test')}
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
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
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    fontSize: 15,
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
  urlRow: { marginBottom: 8 },
  urlInputWrapper: { position: 'relative' },
  urlTrailing: {
    position: 'absolute',
    right: 8,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 4,
  },
  actionRowText: { fontSize: 14, fontWeight: '500' },
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
});
