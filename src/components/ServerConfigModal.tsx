/**
 * 服务器配置模态框
 * 用于添加或编辑服务器配置
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  Host,
  OutlinedTextField,
  Switch,
  AlertDialog,
  TextButton,
  Text as ComposeText,
} from '@expo/ui/jetpack-compose';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import { spacing, radius, typography } from '@/theme';
import { ServerConfig } from '@/types/api';
import { createAPIClient } from '@/services';

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
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string } | null>(null);
  const testAbortControllerRef = useRef<AbortController | null>(null);

  const showAlert = (title: string, message: string) => setAlertInfo({ title, message });

  // OutlinedTextField 是非受控的，重新填充表单时通过 bump formKey 强制重挂载以刷新 defaultValue
  const [formKey, setFormKey] = useState(0);

  const [type, setType] = useState<'syncclipboard' | 'webdav' | 's3'>(
    initialConfig?.type || 'syncclipboard'
  );
  const [url, setUrl] = useState(initialConfig?.url || '');
  const [username, setUsername] = useState(initialConfig?.username || '');
  const [password, setPassword] = useState(initialConfig?.password || '');

  // S3 专有字段
  const [serverName, setServerName] = useState(initialConfig?.name || '');
  const [region, setRegion] = useState(initialConfig?.region || 'us-east-1');
  const [bucketName, setBucketName] = useState(initialConfig?.bucketName || '');
  const [objectPrefix, setObjectPrefix] = useState(initialConfig?.objectPrefix || '');
  const [forcePathStyle, setForcePathStyle] = useState(initialConfig?.forcePathStyle ?? false);

  useEffect(() => {
    if (visible && initialConfig) {
      setType(initialConfig.type);
      setUrl(initialConfig.url);
      setUsername(initialConfig.username || '');
      setPassword(initialConfig.password || '');
      setServerName(initialConfig.name || '');
      setRegion(initialConfig.region || 'us-east-1');
      setBucketName(initialConfig.bucketName || '');
      setObjectPrefix(initialConfig.objectPrefix || '');
      setForcePathStyle(initialConfig.forcePathStyle ?? false);
      setFormKey((k) => k + 1);
    } else if (visible && !initialConfig) {
      setType('syncclipboard');
      setUrl('');
      setUsername('');
      setPassword('');
      setServerName('');
      setRegion('us-east-1');
      setBucketName('');
      setObjectPrefix('');
      setForcePathStyle(false);
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

  const validateForm = (): boolean => {
    if (type === 's3') {
      // S3：bucketName 必填，url 可选（AWS 原生时留空）
      if (!bucketName.trim()) {
        showAlert('错误', '请输入存储桶名称');
        return false;
      }
      if (!username.trim()) {
        showAlert('错误', '请输入 Access Key ID');
        return false;
      }
      if (!password.trim()) {
        showAlert('错误', '请输入 Secret Access Key');
        return false;
      }
      if (url.trim()) {
        try {
          new URL(url);
        } catch {
          showAlert('错误', '端点地址格式不正确');
          return false;
        }
      }
      return true;
    }

    if (!url.trim()) {
      showAlert('错误', '请输入服务器地址');
      return false;
    }

    try {
      new URL(url);
    } catch {
      showAlert('错误', '服务器地址格式不正确');
      return false;
    }

    if (!username.trim()) {
      showAlert('错误', '请输入用户名');
      return false;
    }

    if (!password.trim()) {
      showAlert('错误', '请输入密码');
      return false;
    }

    return true;
  };

  const handleTestConnection = async () => {
    if (isTesting && testAbortControllerRef.current) {
      testAbortControllerRef.current.abort();
      testAbortControllerRef.current = null;
      setIsTesting(false);
      return;
    }

    if (type === 's3') {
      if (!bucketName.trim() || !username.trim() || !password.trim()) {
        showAlert('提示', '请先填写存储桶名称、Access Key ID 和 Secret Access Key');
        return;
      }
    } else if (!url.trim() || !username.trim() || !password.trim()) {
      showAlert('提示', '请先填写服务器地址、用户名和密码');
      return;
    }

    setIsTesting(true);
    testAbortControllerRef.current = new AbortController();

    try {
      const testConfig: ServerConfig = {
        type,
        url: url.trim(),
        username: username.trim(),
        password: password.trim(),
        ...(type === 's3' && {
          region: region.trim() || 'us-east-1',
          bucketName: bucketName.trim(),
          objectPrefix: objectPrefix.trim(),
          forcePathStyle,
        }),
      };

      console.log('[ServerConfigModal] Testing connection:', testConfig.url);
      const client = createAPIClient(testConfig);
      await client.testConnection(testAbortControllerRef.current.signal);
      console.log('[ServerConfigModal] Test succeeded');

      showAlert('成功', '服务器连接测试成功！');
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[ServerConfigModal] Test cancelled');
        return;
      }
      console.error('[ServerConfigModal] Test failed:', error);
      showAlert('连接失败', error instanceof Error ? error.message : '无法连接到服务器');
    } finally {
      setIsTesting(false);
      testAbortControllerRef.current = null;
    }
  };

  const handleSave = () => {
    if (!validateForm()) {
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
          <View style={[styles.header, { borderBottomColor: theme.colors.divider }]}>
            <TouchableOpacity onPress={handleClose} style={styles.headerButton}>
              <Text style={[styles.headerButtonText, { color: theme.colors.primary }]}>取消</Text>
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
              {isEditing ? '编辑服务器' : '添加服务器'}
            </Text>
            <TouchableOpacity onPress={handleSave} style={styles.headerButton}>
              <Text
                style={[
                  styles.headerButtonText,
                  styles.headerButtonBold,
                  { color: theme.colors.primary },
                ]}
              >
                保存
              </Text>
            </TouchableOpacity>
          </View>

          {/* Form */}
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* 服务器类型 */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
                服务器类型
              </Text>
              <View
                style={[
                  styles.card,
                  { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
                ]}
              >
                <TouchableOpacity
                  style={[
                    styles.typeOption,
                    { borderBottomColor: theme.colors.divider },
                    type === 'syncclipboard' && {
                      backgroundColor: theme.colors.primaryContainer,
                    },
                  ]}
                  onPress={() => setType('syncclipboard')}
                >
                  <View style={styles.typeContent}>
                    <Text style={[styles.typeLabel, { color: theme.colors.text }]}>
                      SyncClipboard 服务器
                    </Text>
                    <Text style={[styles.typeDescription, { color: theme.colors.textSecondary }]}>
                      官方独立服务器或客户端内置服务器
                    </Text>
                  </View>
                  {type === 'syncclipboard' && (
                    <View style={[styles.checkmark, { backgroundColor: theme.colors.primary }]}>
                      <Text style={[styles.checkmarkIcon, { color: theme.colors.white }]}>✓</Text>
                    </View>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.typeOption,
                    { borderBottomColor: theme.colors.divider },
                    type === 'webdav' && { backgroundColor: theme.colors.primaryContainer },
                  ]}
                  onPress={() => setType('webdav')}
                >
                  <View style={styles.typeContent}>
                    <Text style={[styles.typeLabel, { color: theme.colors.text }]}>
                      WebDAV 服务器
                    </Text>
                    <Text style={[styles.typeDescription, { color: theme.colors.textSecondary }]}>
                      支持 WebDAV 协议的云存储服务
                    </Text>
                  </View>
                  {type === 'webdav' && (
                    <View style={[styles.checkmark, { backgroundColor: theme.colors.primary }]}>
                      <Text style={[styles.checkmarkIcon, { color: theme.colors.white }]}>✓</Text>
                    </View>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.typeOption,
                    type === 's3' && { backgroundColor: theme.colors.primaryContainer },
                  ]}
                  onPress={() => setType('s3')}
                >
                  <View style={styles.typeContent}>
                    <Text style={[styles.typeLabel, { color: theme.colors.text }]}>
                      S3 兼容存储
                    </Text>
                    <Text style={[styles.typeDescription, { color: theme.colors.textSecondary }]}>
                      AWS S3 / MinIO / Cloudflare R2 等
                    </Text>
                  </View>
                  {type === 's3' && (
                    <View style={[styles.checkmark, { backgroundColor: theme.colors.primary }]}>
                      <Text style={[styles.checkmarkIcon, { color: theme.colors.white }]}>✓</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {/* 服务器信息 */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
                连接信息
              </Text>
              <View
                style={[
                  styles.card,
                  { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
                ]}
              >
                {type === 's3' ? (
                  <>
                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>名称</Text>
                      <Host matchContents>
                        <OutlinedTextField
                          key={`serverName-${formKey}`}
                          defaultValue={serverName}
                          onValueChange={setServerName}
                          keyboardOptions={{ capitalization: 'none', autoCorrectEnabled: false }}
                          singleLine
                          modifiers={[fillMaxWidth()]}
                        >
                          <OutlinedTextField.Placeholder>
                            <ComposeText>可选，用于卡片显示</ComposeText>
                          </OutlinedTextField.Placeholder>
                        </OutlinedTextField>
                      </Host>
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                        存储桶名称 *
                      </Text>
                      <Host matchContents>
                        <OutlinedTextField
                          key={`bucketName-${formKey}`}
                          defaultValue={bucketName}
                          onValueChange={setBucketName}
                          keyboardOptions={{ capitalization: 'none', autoCorrectEnabled: false }}
                          singleLine
                          modifiers={[fillMaxWidth()]}
                        >
                          <OutlinedTextField.Placeholder>
                            <ComposeText>my-bucket</ComposeText>
                          </OutlinedTextField.Placeholder>
                        </OutlinedTextField>
                      </Host>
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                        Access Key ID *
                      </Text>
                      <Host matchContents>
                        <OutlinedTextField
                          key={`s3-username-${formKey}`}
                          defaultValue={username}
                          onValueChange={setUsername}
                          keyboardOptions={{ capitalization: 'none', autoCorrectEnabled: false }}
                          singleLine
                          modifiers={[fillMaxWidth()]}
                        />
                      </Host>
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                        Secret Access Key *
                      </Text>
                      <Host matchContents>
                        <OutlinedTextField
                          key={`s3-password-${formKey}`}
                          defaultValue={password}
                          onValueChange={setPassword}
                          keyboardOptions={{
                            keyboardType: 'password',
                            capitalization: 'none',
                            autoCorrectEnabled: false,
                          }}
                          singleLine
                          modifiers={[fillMaxWidth()]}
                        />
                      </Host>
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                        端点地址
                      </Text>
                      <Host matchContents>
                        <OutlinedTextField
                          key={`s3-url-${formKey}`}
                          defaultValue={url}
                          onValueChange={setUrl}
                          keyboardOptions={{
                            keyboardType: 'uri',
                            capitalization: 'none',
                            autoCorrectEnabled: false,
                          }}
                          singleLine
                          modifiers={[fillMaxWidth()]}
                        >
                          <OutlinedTextField.Placeholder>
                            <ComposeText>留空使用 AWS 标准端点</ComposeText>
                          </OutlinedTextField.Placeholder>
                        </OutlinedTextField>
                      </Host>
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>区域</Text>
                      <Host matchContents>
                        <OutlinedTextField
                          key={`region-${formKey}`}
                          defaultValue={region}
                          onValueChange={setRegion}
                          keyboardOptions={{ capitalization: 'none', autoCorrectEnabled: false }}
                          singleLine
                          modifiers={[fillMaxWidth()]}
                        >
                          <OutlinedTextField.Placeholder>
                            <ComposeText>us-east-1</ComposeText>
                          </OutlinedTextField.Placeholder>
                        </OutlinedTextField>
                      </Host>
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                        对象前缀
                      </Text>
                      <Host matchContents>
                        <OutlinedTextField
                          key={`objectPrefix-${formKey}`}
                          defaultValue={objectPrefix}
                          onValueChange={setObjectPrefix}
                          keyboardOptions={{
                            capitalization: 'none',
                            autoCorrectEnabled: false,
                            imeAction: 'done',
                          }}
                          singleLine
                          modifiers={[fillMaxWidth()]}
                        >
                          <OutlinedTextField.Placeholder>
                            <ComposeText>syncclipboard</ComposeText>
                          </OutlinedTextField.Placeholder>
                        </OutlinedTextField>
                      </Host>
                    </View>

                    <View style={styles.switchGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                        路径风格寻址
                      </Text>
                      <Host matchContents>
                        <Switch
                          value={forcePathStyle}
                          onCheckedChange={setForcePathStyle}
                          colors={{
                            checkedTrackColor: theme.colors.primary,
                            uncheckedTrackColor: theme.colors.divider,
                            checkedThumbColor: theme.colors.surface,
                            uncheckedThumbColor: theme.colors.textTertiary,
                          }}
                        />
                      </Host>
                    </View>
                    <Text style={[styles.hintText, { color: theme.colors.textTertiary }]}>
                      建议 S3 兼容服务器启用路径风格寻址
                    </Text>
                  </>
                ) : (
                  <>
                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                        服务器地址
                      </Text>
                      <Host matchContents>
                        <OutlinedTextField
                          key={`url-${formKey}`}
                          defaultValue={url}
                          onValueChange={setUrl}
                          keyboardOptions={{
                            keyboardType: 'uri',
                            capitalization: 'none',
                            autoCorrectEnabled: false,
                          }}
                          singleLine
                          modifiers={[fillMaxWidth()]}
                        />
                      </Host>
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>用户名</Text>
                      <Host matchContents>
                        <OutlinedTextField
                          key={`username-${formKey}`}
                          defaultValue={username}
                          onValueChange={setUsername}
                          keyboardOptions={{ capitalization: 'none', autoCorrectEnabled: false }}
                          singleLine
                          modifiers={[fillMaxWidth()]}
                        />
                      </Host>
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>密码</Text>
                      <Host matchContents>
                        <OutlinedTextField
                          key={`password-${formKey}`}
                          defaultValue={password}
                          onValueChange={setPassword}
                          keyboardOptions={{
                            keyboardType: 'password',
                            capitalization: 'none',
                            autoCorrectEnabled: false,
                            imeAction: 'done',
                          }}
                          singleLine
                          modifiers={[fillMaxWidth()]}
                        />
                      </Host>
                    </View>
                  </>
                )}
              </View>
            </View>
          </ScrollView>

          <View
            style={[
              styles.footer,
              { backgroundColor: theme.colors.background, borderTopColor: theme.colors.divider },
            ]}
          >
            <TouchableOpacity
              style={[
                styles.testButton,
                {
                  backgroundColor: isTesting
                    ? theme.colors.errorContainer
                    : theme.colors.primaryContainer,
                },
              ]}
              onPress={handleTestConnection}
            >
              {isTesting ? (
                <Text style={[styles.testButtonText, { color: theme.colors.onErrorContainer }]}>
                  取消测试
                </Text>
              ) : (
                <Text style={[styles.testButtonText, { color: theme.colors.onPrimaryContainer }]}>
                  测试连接
                </Text>
              )}
            </TouchableOpacity>
          </View>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
  headerButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    minWidth: 60,
  },
  headerButtonText: {
    fontSize: typography.headline.fontSize,
  },
  headerTitle: {
    fontSize: typography.headline.fontSize,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.base,
  },
  footer: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
  section: {
    marginTop: spacing.lg,
  },
  sectionTitle: {
    fontSize: typography.sectionHeader.fontSize,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: typography.sectionHeader.letterSpacing,
    marginHorizontal: spacing.base,
    marginBottom: spacing.sm,
  },
  card: {
    marginHorizontal: spacing.base,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    padding: spacing.base,
  },
  typeOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  typeContent: {
    flex: 1,
  },
  typeLabel: {
    fontSize: typography.callout.fontSize,
    fontWeight: '500',
    marginBottom: spacing.xs,
  },
  typeDescription: {
    fontSize: typography.footnote.fontSize,
  },
  checkmark: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: spacing.md,
  },
  checkmarkIcon: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  inputGroup: {
    marginBottom: spacing.base,
  },
  switchGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  hintText: {
    fontSize: typography.caption1.fontSize,
    marginBottom: spacing.base,
  },
  inputLabel: {
    fontSize: typography.subhead.fontSize,
    fontWeight: '500',
    marginBottom: spacing.sm,
  },
  input: {
    fontSize: typography.callout.fontSize,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  inputHint: {
    fontSize: typography.caption1.fontSize,
    marginTop: spacing.xs,
  },
  testButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    borderRadius: radius.pill,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  testButtonText: {
    fontSize: typography.callout.fontSize,
    fontWeight: '600',
  },
  headerButtonBold: {
    fontWeight: '600',
  },
});
