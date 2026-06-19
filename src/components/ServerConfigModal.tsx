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
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Switch,
} from 'react-native';
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
  const testAbortControllerRef = useRef<AbortController | null>(null);

  const urlRef = useRef<TextInput>(null);
  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

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

  const bucketNameRef = useRef<TextInput>(null);
  const regionRef = useRef<TextInput>(null);
  const objectPrefixRef = useRef<TextInput>(null);

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
        Alert.alert('Error', 'Enter bucket name');
        return false;
      }
      if (!username.trim()) {
        Alert.alert('Error', 'Enter Access Key ID');
        return false;
      }
      if (!password.trim()) {
        Alert.alert('Error', 'Enter Secret Access Key');
        return false;
      }
      if (url.trim()) {
        try {
          new URL(url);
        } catch {
          Alert.alert('Error', 'Invalid endpoint URL');
          return false;
        }
      }
      return true;
    }

    if (!url.trim()) {
      Alert.alert('Error', 'Enter server URL');
      return false;
    }

    try {
      new URL(url);
    } catch {
      Alert.alert('Error', 'Invalid server URL format');
      return false;
    }

    if (!username.trim()) {
      Alert.alert('Error', 'Enter username');
      return false;
    }

    if (!password.trim()) {
      Alert.alert('Error', 'Enter password');
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
        Alert.alert('Notice', 'Fill in bucket name, Access Key ID and Secret Access Key first');
        return;
      }
    } else if (!url.trim() || !username.trim() || !password.trim()) {
      Alert.alert('Notice', 'Fill in server URL, username and password first');
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

      Alert.alert('Success', 'Server connection test successful!');
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[ServerConfigModal] Test cancelled');
        return;
      }
      console.error('[ServerConfigModal] Test failed:', error);
      Alert.alert('Connection Failed', error instanceof Error ? error.message : 'Unable to connect to server');
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
              <Text style={[styles.headerButtonText, { color: theme.colors.primary }]}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
              {isEditing ? 'Edit Server' : 'Add Server'}
            </Text>
            <TouchableOpacity onPress={handleSave} style={styles.headerButton}>
              <Text
                style={[
                  styles.headerButtonText,
                  styles.headerButtonBold,
                  { color: theme.colors.primary },
                ]}
              >
                Save
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
                 Server Type
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
                      SyncClipboard Server
                    </Text>
                    <Text style={[styles.typeDescription, { color: theme.colors.textSecondary }]}>
                      Official standalone server or built-in server
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
                      WebDAV Server
                    </Text>
                    <Text style={[styles.typeDescription, { color: theme.colors.textSecondary }]}>
                      Cloud storage with WebDAV support
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
                      S3 Compatible
                    </Text>
                    <Text style={[styles.typeDescription, { color: theme.colors.textSecondary }]}>
                      AWS S3 / MinIO / Cloudflare R2 etc.
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
                 Connection
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
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>Name</Text>
                      <TextInput
                        style={[
                          styles.input,
                          {
                            color: theme.colors.text,
                            backgroundColor: theme.colors.background,
                            borderColor: theme.colors.divider,
                          },
                        ]}
                        placeholder="Optional, for display on card"
                        placeholderTextColor={theme.colors.textTertiary}
                        value={serverName}
                        onChangeText={setServerName}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="next"
                        submitBehavior="submit"
                        onSubmitEditing={() => bucketNameRef.current?.focus()}
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                        Bucket Name *
                      </Text>
                      <TextInput
                        ref={bucketNameRef}
                        style={[
                          styles.input,
                          {
                            color: theme.colors.text,
                            backgroundColor: theme.colors.background,
                            borderColor: theme.colors.divider,
                          },
                        ]}
                        placeholder="my-bucket"
                        placeholderTextColor={theme.colors.textTertiary}
                        value={bucketName}
                        onChangeText={setBucketName}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="next"
                        submitBehavior="submit"
                        onSubmitEditing={() => usernameRef.current?.focus()}
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                        Access Key ID *
                      </Text>
                      <TextInput
                        ref={usernameRef}
                        style={[
                          styles.input,
                          {
                            color: theme.colors.text,
                            backgroundColor: theme.colors.background,
                            borderColor: theme.colors.divider,
                          },
                        ]}
                        placeholder=""
                        placeholderTextColor={theme.colors.textTertiary}
                        value={username}
                        onChangeText={setUsername}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="next"
                        submitBehavior="submit"
                        onSubmitEditing={() => passwordRef.current?.focus()}
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                        Secret Access Key *
                      </Text>
                      <TextInput
                        ref={passwordRef}
                        style={[
                          styles.input,
                          {
                            color: theme.colors.text,
                            backgroundColor: theme.colors.background,
                            borderColor: theme.colors.divider,
                          },
                        ]}
                        placeholder=""
                        placeholderTextColor={theme.colors.textTertiary}
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="next"
                        submitBehavior="submit"
                        onSubmitEditing={() => urlRef.current?.focus()}
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                        Endpoint URL
                      </Text>
                      <TextInput
                        ref={urlRef}
                        style={[
                          styles.input,
                          {
                            color: theme.colors.text,
                            backgroundColor: theme.colors.background,
                            borderColor: theme.colors.divider,
                          },
                        ]}
                        placeholder="Leave empty for AWS standard endpoint"
                        placeholderTextColor={theme.colors.textTertiary}
                        value={url}
                        onChangeText={setUrl}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                        returnKeyType="next"
                        submitBehavior="submit"
                        onSubmitEditing={() => regionRef.current?.focus()}
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>Region</Text>
                      <TextInput
                        ref={regionRef}
                        style={[
                          styles.input,
                          {
                            color: theme.colors.text,
                            backgroundColor: theme.colors.background,
                            borderColor: theme.colors.divider,
                          },
                        ]}
                        placeholder="us-east-1"
                        placeholderTextColor={theme.colors.textTertiary}
                        value={region}
                        onChangeText={setRegion}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="next"
                        submitBehavior="submit"
                        onSubmitEditing={() => objectPrefixRef.current?.focus()}
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                        Object Prefix
                      </Text>
                      <TextInput
                        ref={objectPrefixRef}
                        style={[
                          styles.input,
                          {
                            color: theme.colors.text,
                            backgroundColor: theme.colors.background,
                            borderColor: theme.colors.divider,
                          },
                        ]}
                        placeholder="syncclipboard"
                        placeholderTextColor={theme.colors.textTertiary}
                        value={objectPrefix}
                        onChangeText={setObjectPrefix}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="done"
                        onSubmitEditing={() => objectPrefixRef.current?.blur()}
                      />
                    </View>

                    <View style={styles.switchGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                        Path-Style Addressing
                      </Text>
                      <Switch
                        value={forcePathStyle}
                        onValueChange={setForcePathStyle}
                        trackColor={{ false: theme.colors.divider, true: theme.colors.primary }}
                        thumbColor={
                          forcePathStyle ? theme.colors.surface : theme.colors.textTertiary
                        }
                      />
                    </View>
                    <Text style={[styles.hintText, { color: theme.colors.textTertiary }]}>
                      Recommended for S3-compatible servers
                    </Text>
                  </>
                ) : (
                  <>
                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                        Server URL
                      </Text>
                      <TextInput
                        ref={urlRef}
                        style={[
                          styles.input,
                          {
                            color: theme.colors.text,
                            backgroundColor: theme.colors.background,
                            borderColor: theme.colors.divider,
                          },
                        ]}
                        placeholder=""
                        placeholderTextColor={theme.colors.textTertiary}
                        value={url}
                        onChangeText={setUrl}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                        returnKeyType="next"
                        submitBehavior="submit"
                        onSubmitEditing={() => usernameRef.current?.focus()}
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>Username</Text>
                      <TextInput
                        ref={usernameRef}
                        style={[
                          styles.input,
                          {
                            color: theme.colors.text,
                            backgroundColor: theme.colors.background,
                            borderColor: theme.colors.divider,
                          },
                        ]}
                        placeholder=""
                        placeholderTextColor={theme.colors.textTertiary}
                        value={username}
                        onChangeText={setUsername}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="next"
                        submitBehavior="submit"
                        onSubmitEditing={() => passwordRef.current?.focus()}
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>Password</Text>
                      <TextInput
                        ref={passwordRef}
                        style={[
                          styles.input,
                          {
                            color: theme.colors.text,
                            backgroundColor: theme.colors.background,
                            borderColor: theme.colors.divider,
                          },
                        ]}
                        placeholder=""
                        placeholderTextColor={theme.colors.textTertiary}
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="done"
                        onSubmitEditing={() => passwordRef.current?.blur()}
                      />
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
                  Cancel Test
                </Text>
              ) : (
                <Text style={[styles.testButtonText, { color: theme.colors.onPrimaryContainer }]}>
                  Test Connection
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
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
