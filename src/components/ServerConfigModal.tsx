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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
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

  const [type, setType] = useState<'syncclipboard' | 'webdav'>(
    initialConfig?.type || 'syncclipboard'
  );
  const [url, setUrl] = useState(initialConfig?.url || '');
  const [username, setUsername] = useState(initialConfig?.username || '');
  const [password, setPassword] = useState(initialConfig?.password || '');

  useEffect(() => {
    if (visible && initialConfig) {
      setType(initialConfig.type);
      setUrl(initialConfig.url);
      setUsername(initialConfig.username || '');
      setPassword(initialConfig.password || '');
    } else if (visible && !initialConfig) {
      setType('syncclipboard');
      setUrl('');
      setUsername('');
      setPassword('');
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
    if (!url.trim()) {
      Alert.alert('错误', '请输入服务器地址');
      return false;
    }

    try {
      new URL(url);
    } catch {
      Alert.alert('错误', '服务器地址格式不正确');
      return false;
    }

    if (!username.trim()) {
      Alert.alert('错误', '请输入用户名');
      return false;
    }

    if (!password.trim()) {
      Alert.alert('错误', '请输入密码');
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

    if (!url.trim() || !username.trim() || !password.trim()) {
      Alert.alert('提示', '请先填写服务器地址、用户名和密码');
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
      };

      console.log('[ServerConfigModal] Testing connection:', testConfig.url);
      const client = createAPIClient(testConfig);
      await client.testConnection(testAbortControllerRef.current.signal);
      console.log('[ServerConfigModal] Test succeeded');

      Alert.alert('成功', '服务器连接测试成功！');
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[ServerConfigModal] Test cancelled');
        return;
      }
      console.error('[ServerConfigModal] Test failed:', error);
      Alert.alert('连接失败', error instanceof Error ? error.message : '无法连接到服务器');
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
                      backgroundColor: theme.colors.primary + '10',
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
                    type === 'webdav' && { backgroundColor: theme.colors.primary + '10' },
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
                <View style={styles.inputGroup}>
                  <Text style={[styles.inputLabel, { color: theme.colors.text }]}>服务器地址</Text>
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
                  <Text style={[styles.inputLabel, { color: theme.colors.text }]}>用户名</Text>
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
                  <Text style={[styles.inputLabel, { color: theme.colors.text }]}>密码</Text>
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
                isTesting
                  ? {
                      backgroundColor: theme.colors.error + '20',
                      borderColor: theme.colors.error,
                    }
                  : {
                      backgroundColor: theme.colors.primary + '20',
                      borderColor: theme.colors.primary,
                    },
              ]}
              onPress={handleTestConnection}
            >
              {isTesting ? (
                <Text style={[styles.testButtonText, { color: theme.colors.error }]}>取消测试</Text>
              ) : (
                <Text style={[styles.testButtonText, { color: theme.colors.primary }]}>
                  测试连接
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    minWidth: 60,
  },
  headerButtonText: {
    fontSize: 17,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 16,
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  section: {
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  card: {
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
  },
  typeOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  typeContent: {
    flex: 1,
  },
  typeLabel: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  typeDescription: {
    fontSize: 13,
  },
  checkmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  checkmarkIcon: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 8,
  },
  input: {
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  inputHint: {
    fontSize: 12,
    marginTop: 4,
  },
  testButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    marginTop: 8,
  },
  testButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  headerButtonBold: {
    fontWeight: '600',
  },
});
