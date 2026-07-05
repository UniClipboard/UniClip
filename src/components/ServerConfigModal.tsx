/**
 * 服务器配置模态框
 * 对齐 iOS AddServerSheet 布局：扫码 → 名称 → 服务器地址 → 凭据 → 测试连接
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
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
import { ServerConfig } from '@/types/api';
import { testConnection as testConnectionViaRust } from 'uc-core';
import { useSettingsStore } from '@/stores';
import { QrScannerModal } from './QrScannerModal';
import { usePendingConnectStore } from '@/stores';

interface ServerConfigModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (config: ServerConfig) => void;
  initialConfig?: ServerConfig;
  isEditing?: boolean;
}

export const ServerConfigModal: React.FC<ServerConfigModalProps> = ({
  visible,
  onClose,
  onSave,
  initialConfig,
  isEditing = false,
}) => {
  const { theme } = useTheme();
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'failed' | null>(null);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string } | null>(null);
  const testAbortControllerRef = useRef<AbortController | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const consumePendingConnect = usePendingConnectStore((s) => s.consume);
  const settings = useSettingsStore((s) => s.config);

  const showAlert = (title: string, message: string) => setAlertInfo({ title, message });

  const fieldColors = {
    focusedContainerColor: 'transparent',
    unfocusedContainerColor: 'transparent',
    focusedIndicatorColor: theme.colors.accent,
    unfocusedIndicatorColor: theme.colors.separator,
    focusedTextColor: theme.colors.textPrimary,
    unfocusedTextColor: theme.colors.textPrimary,
    focusedPlaceholderColor: theme.colors.textSecondary,
    unfocusedPlaceholderColor: theme.colors.textSecondary,
    focusedLabelColor: theme.colors.accent,
    unfocusedLabelColor: theme.colors.textSecondary,
    cursorColor: theme.colors.accent,
  };

  const [formKey, setFormKey] = useState(0);

  // 保留 type 字段但 UI 不展示 webdav/s3（未来启用）
  const [type, setType] = useState<'syncclipboard' | 'webdav' | 's3'>(
    initialConfig?.type || 'syncclipboard'
  );
  const [serverName, setServerName] = useState(initialConfig?.name || '');
  const [url, setUrl] = useState(initialConfig?.url || '');
  const [username, setUsername] = useState(initialConfig?.username || '');
  const [password, setPassword] = useState(initialConfig?.password || '');

  // Native state for OutlinedTextField (SDK 56 migration)
  const nameNativeState = useNativeState(serverName);
  const urlNativeState = useNativeState(url);
  const usernameNativeState = useNativeState(username);
  const passwordNativeState = useNativeState(password);

  // S3 专有字段（保留，UI 隐藏）
  const [region, setRegion] = useState(initialConfig?.region || 'us-east-1');
  const [bucketName, setBucketName] = useState(initialConfig?.bucketName || '');
  const [objectPrefix, setObjectPrefix] = useState(initialConfig?.objectPrefix || '');
  const [forcePathStyle, setForcePathStyle] = useState(initialConfig?.forcePathStyle ?? false);

  useEffect(() => {
    if (visible && initialConfig) {
      setType(initialConfig.type);
      setServerName(initialConfig.name || '');
      setUrl(initialConfig.url);
      setUsername(initialConfig.username || '');
      setPassword(initialConfig.password || '');
      setRegion(initialConfig.region || 'us-east-1');
      setBucketName(initialConfig.bucketName || '');
      setObjectPrefix(initialConfig.objectPrefix || '');
      setForcePathStyle(initialConfig.forcePathStyle ?? false);
      setTestResult(null);
      setFormKey((k) => k + 1);
    } else if (visible && !initialConfig) {
      setType('syncclipboard');
      setServerName('');
      setUrl('');
      setUsername('');
      setPassword('');
      setRegion('us-east-1');
      setBucketName('');
      setObjectPrefix('');
      setForcePathStyle(false);
      setTestResult(null);
      setFormKey((k) => k + 1);
    }
  }, [visible, initialConfig]);

  useEffect(() => {
    return () => {
      if (testAbortControllerRef.current) {
        testAbortControllerRef.current.abort();
        testAbortControllerRef.current = null;
      }
    };
  }, []);

  const handleClose = () => {
    if (testAbortControllerRef.current) {
      testAbortControllerRef.current.abort();
      testAbortControllerRef.current = null;
      setIsTesting(false);
    }
    onClose();
  };

  const canSave = url.trim().length > 0 && username.trim().length > 0 && password.trim().length > 0;

  const handleSave = () => {
    if (!canSave) {
      showAlert('提示', '请填写服务器地址、用户名和密码');
      return;
    }
    try {
      new URL(url.trim());
    } catch {
      showAlert('错误', '服务器地址格式不正确');
      return;
    }

    const config: ServerConfig = {
      type,
      url: url.trim(),
      username: username.trim(),
      password: password.trim(),
      ...(serverName.trim() ? { name: serverName.trim() } : {}),
      ...(type === 's3' && {
        region: region.trim() || 'us-east-1',
        bucketName: bucketName.trim(),
        objectPrefix: objectPrefix.trim(),
        forcePathStyle,
      }),
    };

    onSave(config);
    handleClose();
  };

  const handleTestConnection = async () => {
    if (isTesting && testAbortControllerRef.current) {
      testAbortControllerRef.current.abort();
      testAbortControllerRef.current = null;
      setIsTesting(false);
      return;
    }

    if (!url.trim() || !username.trim() || !password.trim()) {
      showAlert('提示', '请先填写服务器地址、用户名和密码');
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    testAbortControllerRef.current = new AbortController();

    try {
      const result = await testConnectionViaRust(
        { baseUrl: url.trim(), username: username.trim(), password: password.trim() },
        settings?.trustInsecureCert ?? false
      );
      if (result === 'Success') {
        setTestResult('success');
      } else {
        setTestResult('failed');
        const messages: Record<string, string> = {
          AuthFailed: '认证失败，请检查用户名和密码。',
          Unreachable: '无法连接到服务器。',
          MissingFields: '请填写完整的连接信息。',
        };
        showAlert('连接失败', messages[result] ?? '未知错误');
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setTestResult('failed');
      showAlert('连接失败', error instanceof Error ? error.message : '无法连接到服务器');
    } finally {
      setIsTesting(false);
      testAbortControllerRef.current = null;
    }
  };

  // 扫码完成后从 pendingConnectStore 消费数据填充表单
  const handleScanComplete = () => {
    setShowScanner(false);
    const intent = consumePendingConnect();
    if (intent) {
      if (intent.url) setUrl(intent.url);
      if (intent.user) setUsername(intent.user);
      if (intent.pwd) setPassword(intent.pwd);
      if (intent.label) setServerName(intent.label);
      setFormKey((k) => k + 1);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          {/* Header: 取消 / 添加服务器 / 保存 */}
          <View style={[styles.header, { borderBottomColor: theme.colors.separator }]}>
            <Pressable onPress={handleClose} style={styles.headerBtn}>
              <Text style={[styles.headerBtnText, { color: theme.colors.accent }]}>取消</Text>
            </Pressable>
            <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>
              {isEditing ? '编辑服务器' : '添加服务器'}
            </Text>
            <Pressable onPress={handleSave} disabled={!canSave} style={styles.headerBtn}>
              <Text
                style={[
                  styles.headerBtnText,
                  styles.headerBtnBold,
                  { color: canSave ? theme.colors.accent : theme.colors.border },
                ]}
              >
                保存
              </Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* § 扫码连接 */}
            <View style={styles.section}>
              <Pressable
                onPress={() => setShowScanner(true)}
                style={[styles.scanRow, { backgroundColor: theme.colors.surfaceLow }]}
              >
                <Ionicons name="qr-code-outline" size={20} color={theme.colors.accent} />
                <Text style={[styles.scanLabel, { color: theme.colors.accent }]}>扫码连接</Text>
                <Ionicons name="chevron-forward" size={16} color={theme.colors.border} />
              </Pressable>
              <Text style={[styles.sectionFooter, { color: theme.colors.textSecondary }]}>
                扫描桌面端的二维码，一键填充以下信息。
              </Text>
            </View>

            {/* § 名称 */}
            <View style={styles.section}>
              <Text style={[styles.sectionHeader, { color: theme.colors.textSecondary }]}>
                名称
              </Text>
              <Host matchContents style={styles.fieldHost}>
                <OutlinedTextField
                  key={`name-${formKey}`}
                  value={nameNativeState}
                  onValueChange={setServerName}
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
              <Text style={[styles.sectionFooter, { color: theme.colors.textSecondary }]}>
                将显示在剪贴板顶栏。留空会用服务器地址替代。
              </Text>
            </View>

            {/* § 服务器地址 */}
            <View style={styles.section}>
              <Text style={[styles.sectionHeader, { color: theme.colors.textSecondary }]}>
                服务器地址
              </Text>
              <Host matchContents style={styles.fieldHost}>
                <OutlinedTextField
                  key={`url-${formKey}`}
                  value={urlNativeState}
                  onValueChange={(v) => {
                    setUrl(v);
                    setTestResult(null);
                  }}
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
            </View>

            {/* § 凭据 */}
            <View style={styles.section}>
              <Text style={[styles.sectionHeader, { color: theme.colors.textSecondary }]}>
                凭据
              </Text>
              <Host matchContents style={styles.fieldHost}>
                <OutlinedTextField
                  key={`username-${formKey}`}
                  value={usernameNativeState}
                  onValueChange={(v) => {
                    setUsername(v);
                    setTestResult(null);
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
                    setTestResult(null);
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

            {/* § 连接 */}
            <View style={styles.section}>
              <Text style={[styles.sectionHeader, { color: theme.colors.textSecondary }]}>
                连接
              </Text>
              {testResult && (
                <View
                  style={[
                    styles.testResultRow,
                    {
                      backgroundColor:
                        testResult === 'success' ? 'rgba(76,175,80,0.08)' : 'rgba(244,67,54,0.08)',
                    },
                  ]}
                >
                  <Ionicons
                    name={testResult === 'success' ? 'checkmark-circle' : 'close-circle'}
                    size={20}
                    color={testResult === 'success' ? '#4CAF50' : '#F44336'}
                  />
                  <Text
                    style={{
                      color: testResult === 'success' ? '#4CAF50' : '#F44336',
                      fontSize: 14,
                      fontWeight: '500',
                    }}
                  >
                    {testResult === 'success' ? '连接成功' : '连接失败'}
                  </Text>
                </View>
              )}
              <Pressable
                onPress={handleTestConnection}
                disabled={isTesting && !testAbortControllerRef.current}
                style={[
                  styles.testButton,
                  {
                    backgroundColor: isTesting
                      ? theme.colors.surfaceHigh
                      : theme.colors.surfaceLow,
                  },
                ]}
              >
                {isTesting ? (
                  <>
                    <Ionicons name="stop-circle-outline" size={18} color={theme.colors.error} />
                    <Text style={[styles.testButtonText, { color: theme.colors.error }]}>
                      取消测试
                    </Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="flash-outline" size={18} color={theme.colors.accent} />
                    <Text style={[styles.testButtonText, { color: theme.colors.accent }]}>
                      {testResult ? '重新测试' : '测试连接'}
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
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: {
    paddingVertical: 4,
    paddingHorizontal: 4,
    minWidth: 50,
  },
  headerBtnText: {
    fontSize: 16,
  },
  headerBtnBold: {
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  // Scroll
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  // Sections
  section: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
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
  // Scan row
  scanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
  },
  scanLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  fieldHost: {
    paddingHorizontal: 4,
  },
  // Test connection
  testResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  testButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  testButtonText: {
    fontSize: 15,
    fontWeight: '500',
  },
});
