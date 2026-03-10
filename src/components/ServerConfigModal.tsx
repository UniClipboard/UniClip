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
  ActivityIndicator,
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

  // 输入框 ref
  const urlRef = useRef<TextInput>(null);
  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  // 表单状态
  const [type, setType] = useState<'syncclipboard' | 'webdav'>(
    initialConfig?.type || 'syncclipboard'
  );
  const [url, setUrl] = useState(initialConfig?.url || '');
  const [username, setUsername] = useState(initialConfig?.username || '');
  const [password, setPassword] = useState(initialConfig?.password || '');

  // 重置表单
  useEffect(() => {
    if (visible && initialConfig) {
      setType(initialConfig.type);
      setUrl(initialConfig.url);
      setUsername(initialConfig.username || '');
      setPassword(initialConfig.password || '');
    } else if (visible && !initialConfig) {
      // 新建时重置为空
      setType('syncclipboard');
      setUrl('');
      setUsername('');
      setPassword('');
    }
  }, [visible, initialConfig]);

  // 验证表单
  const validateForm = (): boolean => {
    if (!url.trim()) {
      Alert.alert('错误', '请输入服务器地址');
      return false;
    }

    // 验证 URL 格式
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

  // 测试连接
  const handleTestConnection = async () => {
    if (!url.trim() || !username.trim() || !password.trim()) {
      Alert.alert('提示', '请先填写服务器地址、用户名和密码');
      return;
    }

    setIsTesting(true);
    try {
      const testConfig: ServerConfig = {
        type,
        url: url.trim(),
        username: username.trim(),
        password: password.trim(),
      };

      console.log('[ServerConfigModal] Testing connection:', testConfig.url);
      const client = createAPIClient(testConfig);
      await client.testConnection();
      console.log('[ServerConfigModal] Test succeeded');

      Alert.alert('成功', '服务器连接测试成功！');
    } catch (error: unknown) {
      console.error('[ServerConfigModal] Test failed:', error);
      Alert.alert('连接失败', error instanceof Error ? error.message : '无法连接到服务器');
    } finally {
      setIsTesting(false);
    }
  };

  // 保存配置
  const handleSave = () => {
    if (!validateForm()) {
      return;
    }

    const config: ServerConfig = {
      type,
      url: url.trim(),
      username: username.trim(),
      password: password.trim(),
      autoSync: true,
      syncInterval: 60,
      notificationEnabled: true,
    };

    onSave(config);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: theme.colors.divider }]}>
            <TouchableOpacity onPress={onClose} style={styles.headerButton}>
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
              <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
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
              <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
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

          {/* 测试连接按钮 - 固定在底部 */}
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
                  backgroundColor: theme.colors.primary + '20',
                  borderColor: theme.colors.primary,
                },
              ]}
              onPress={handleTestConnection}
              disabled={isTesting}
            >
              {isTesting ? (
                <ActivityIndicator size="small" color={theme.colors.primary} />
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
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
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
