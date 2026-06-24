/**
 * 调试 section
 *
 * 含 4 个调试开关，以及仅由调试触发的「短信测试」「统计信息」两个底部表单与结果弹窗，
 * 因此这些 modal 的状态/handler 一并内聚到本组件。
 */
import React, { memo, useState } from 'react';
import { View, Text, Platform } from 'react-native';
import {
  Host,
  Card,
  Column,
  Row,
  ListItem,
  Switch as ComposeSwitch,
  Button,
  TextButton,
  OutlinedTextField,
  AlertDialog,
  ModalBottomSheet,
  Spacer,
  HorizontalDivider,
  Text as ComposeText,
  useNativeState,
} from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  width as widthModifier,
  paddingAll,
  height as heightModifier,
} from '@expo/ui/jetpack-compose/modifiers';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/stores';
import { extractVerificationCode } from '@/tasks/SmsUploadTask';
import { useSettingsToast } from './SettingsToastContext';
import { settingsStyles as styles } from './settingsStyles';

export const DebugSection = memo(function DebugSection() {
  const { theme } = useTheme();
  const showMessage = useSettingsToast();

  const debugMode = useSettingsStore((s) => s.config?.debugMode ?? false);
  const debugOverlayVisible = useSettingsStore((s) => s.config?.debugOverlayVisible ?? false);
  const debugUrlScheme = useSettingsStore((s) => s.config?.debugUrlScheme ?? false);
  const debugUpdateCheckNoLimit = useSettingsStore(
    (s) => s.config?.debugUpdateCheckNoLimit ?? false
  );

  const [showSmsTestModal, setShowSmsTestModal] = useState(false);
  const [smsTestInput, setSmsTestInput] = useState('');
  const [smsTestResult, setSmsTestResult] = useState<{ title: string; message: string } | null>(
    null
  );
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [statsText, setStatsText] = useState('');
  const smsTestNativeState = useNativeState(smsTestInput);

  const handleToggleDebugMode = async (enabled: boolean) => {
    try {
      await useSettingsStore.getState().updateConfig({ debugMode: enabled });
      showMessage(enabled ? '已启用调试模式' : '已禁用调试模式', 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  const handleToggleDebugOverlayVisible = async (enabled: boolean) => {
    try {
      await useSettingsStore.getState().updateConfig({ debugOverlayVisible: enabled });
      showMessage(enabled ? '悬浮窗将在后台时可见' : '悬浮窗已隐藏', 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  const handleToggleDebugUrlScheme = async (enabled: boolean) => {
    try {
      await useSettingsStore.getState().updateConfig({ debugUrlScheme: enabled });
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  const handleToggleDebugUpdateCheckNoLimit = async (enabled: boolean) => {
    try {
      await useSettingsStore.getState().updateConfig({ debugUpdateCheckNoLimit: enabled });
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  const handleTestSmsCode = () => {
    const code = extractVerificationCode(smsTestInput);
    setSmsTestResult(
      code
        ? { title: '提取成功', message: `验证码: ${code}` }
        : { title: '提取失败', message: '未能从输入文本中提取到验证码' }
    );
  };

  const handleShowStatistics = async () => {
    const { useStatisticsStore } = await import('@/stores/statisticsStore');
    const store = useStatisticsStore.getState();
    if (!store.isLoaded) {
      await store.load();
    }
    setStatsText(useStatisticsStore.getState().getStatisticsText());
    setShowStatsModal(true);
  };

  const handleCopyStatistics = async () => {
    const Clipboard = await import('expo-clipboard');
    await Clipboard.setStringAsync(statsText);
    setShowStatsModal(false);
    showMessage('已复制统计信息', 'success');
  };

  const switchColors = {
    checkedTrackColor: theme.colors.primary,
    uncheckedTrackColor: theme.colors.divider,
    checkedThumbColor: theme.colors.surface,
    uncheckedThumbColor: theme.colors.textTertiary,
  };
  const buttonColors = { containerColor: theme.colors.primary, contentColor: theme.colors.white };

  return (
    <>
      <View style={styles.section}>
        <View style={styles.sectionHeaderBase}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>调试</Text>
        </View>

        <Host matchContents={{ vertical: true }} style={styles.hostFill}>
          <Card colors={{ containerColor: theme.colors.surface }}>
            <Column modifiers={[fillMaxWidth()]}>
              <ListItem colors={{ containerColor: theme.colors.surface }}>
                <ListItem.HeadlineContent>
                  <ComposeText color={theme.colors.text}>调试模式</ComposeText>
                </ListItem.HeadlineContent>
                <ListItem.TrailingContent>
                  <ComposeSwitch
                    value={debugMode}
                    onCheckedChange={handleToggleDebugMode}
                    colors={switchColors}
                  />
                </ListItem.TrailingContent>
              </ListItem>

              {debugMode && Platform.OS === 'android' && (
                <>
                  <HorizontalDivider color={theme.colors.divider} />
                  <ListItem colors={{ containerColor: theme.colors.surface }}>
                    <ListItem.HeadlineContent>
                      <ComposeText color={theme.colors.text}>显示悬浮窗</ComposeText>
                    </ListItem.HeadlineContent>
                    <ListItem.SupportingContent>
                      <ComposeText color={theme.colors.textTertiary}>
                        后台获取剪贴板时显示可见的悬浮窗
                      </ComposeText>
                    </ListItem.SupportingContent>
                    <ListItem.TrailingContent>
                      <ComposeSwitch
                        value={debugOverlayVisible}
                        onCheckedChange={handleToggleDebugOverlayVisible}
                        colors={switchColors}
                      />
                    </ListItem.TrailingContent>
                  </ListItem>
                </>
              )}

              {debugMode && (
                <>
                  <HorizontalDivider color={theme.colors.divider} />
                  <ListItem colors={{ containerColor: theme.colors.surface }}>
                    <ListItem.HeadlineContent>
                      <ComposeText color={theme.colors.text}>显示 URL Scheme 调用</ComposeText>
                    </ListItem.HeadlineContent>
                    <ListItem.TrailingContent>
                      <ComposeSwitch
                        value={debugUrlScheme}
                        onCheckedChange={handleToggleDebugUrlScheme}
                        colors={switchColors}
                      />
                    </ListItem.TrailingContent>
                  </ListItem>
                </>
              )}

              {debugMode && (
                <>
                  <HorizontalDivider color={theme.colors.divider} />
                  <ListItem colors={{ containerColor: theme.colors.surface }}>
                    <ListItem.HeadlineContent>
                      <ComposeText color={theme.colors.text}>测试验证码短信</ComposeText>
                    </ListItem.HeadlineContent>
                    <ListItem.TrailingContent>
                      <Button
                        onClick={() => {
                          setSmsTestInput('');
                          setShowSmsTestModal(true);
                        }}
                        colors={buttonColors}
                      >
                        <ComposeText>测试</ComposeText>
                      </Button>
                    </ListItem.TrailingContent>
                  </ListItem>
                </>
              )}

              {debugMode && (
                <>
                  <HorizontalDivider color={theme.colors.divider} />
                  <ListItem colors={{ containerColor: theme.colors.surface }}>
                    <ListItem.HeadlineContent>
                      <ComposeText color={theme.colors.text}>更新检查不限次数</ComposeText>
                    </ListItem.HeadlineContent>
                    <ListItem.SupportingContent>
                      <ComposeText color={theme.colors.textTertiary}>
                        开启后每次启动均检查更新，不限每天一次
                      </ComposeText>
                    </ListItem.SupportingContent>
                    <ListItem.TrailingContent>
                      <ComposeSwitch
                        value={debugUpdateCheckNoLimit}
                        onCheckedChange={handleToggleDebugUpdateCheckNoLimit}
                        colors={switchColors}
                      />
                    </ListItem.TrailingContent>
                  </ListItem>
                </>
              )}

              {debugMode && (
                <>
                  <HorizontalDivider color={theme.colors.divider} />
                  <ListItem colors={{ containerColor: theme.colors.surface }}>
                    <ListItem.HeadlineContent>
                      <ComposeText color={theme.colors.text}>统计信息</ComposeText>
                    </ListItem.HeadlineContent>
                    <ListItem.TrailingContent>
                      <Button onClick={handleShowStatistics} colors={buttonColors}>
                        <ComposeText>查看</ComposeText>
                      </Button>
                    </ListItem.TrailingContent>
                  </ListItem>
                </>
              )}
            </Column>
          </Card>
        </Host>
      </View>

      {/* 测试验证码短信底部表单 */}
      {showSmsTestModal && (
        <Host>
          <ModalBottomSheet onDismissRequest={() => setShowSmsTestModal(false)}>
            <Column modifiers={[paddingAll(24), fillMaxWidth()]}>
              <ComposeText color={theme.colors.text} style={{ typography: 'titleLarge' }}>
                测试验证码短信
              </ComposeText>
              <Spacer modifiers={[heightModifier(16)]} />
              <OutlinedTextField
                value={smsTestNativeState}
                onValueChange={setSmsTestInput}
                modifiers={[fillMaxWidth()]}
              >
                <OutlinedTextField.Placeholder>
                  <ComposeText>输入短信内容...</ComposeText>
                </OutlinedTextField.Placeholder>
              </OutlinedTextField>
              <Spacer modifiers={[heightModifier(16)]} />
              <Row modifiers={[fillMaxWidth()]} horizontalArrangement="end">
                <TextButton onClick={() => setShowSmsTestModal(false)}>
                  <ComposeText>取消</ComposeText>
                </TextButton>
                <Spacer modifiers={[widthModifier(8)]} />
                <Button onClick={handleTestSmsCode} colors={buttonColors}>
                  <ComposeText>测试</ComposeText>
                </Button>
              </Row>
            </Column>
          </ModalBottomSheet>
        </Host>
      )}

      {/* 统计信息底部表单 */}
      {showStatsModal && (
        <Host>
          <ModalBottomSheet onDismissRequest={() => setShowStatsModal(false)}>
            <Column modifiers={[paddingAll(24), fillMaxWidth()]}>
              <ComposeText color={theme.colors.text} style={{ typography: 'titleLarge' }}>
                统计信息
              </ComposeText>
              <Spacer modifiers={[heightModifier(16)]} />
              <ComposeText color={theme.colors.text}>{statsText}</ComposeText>
              <Spacer modifiers={[heightModifier(16)]} />
              <Row modifiers={[fillMaxWidth()]} horizontalArrangement="end">
                <TextButton onClick={() => setShowStatsModal(false)}>
                  <ComposeText>关闭</ComposeText>
                </TextButton>
                <Spacer modifiers={[widthModifier(8)]} />
                <Button onClick={handleCopyStatistics} colors={buttonColors}>
                  <ComposeText>复制</ComposeText>
                </Button>
              </Row>
            </Column>
          </ModalBottomSheet>
        </Host>
      )}

      {/* 短信提取结果 */}
      {smsTestResult && (
        <Host>
          <AlertDialog
            onDismissRequest={() => setSmsTestResult(null)}
            colors={{ containerColor: theme.colors.surface }}
          >
            <AlertDialog.Title>
              <ComposeText color={theme.colors.text}>{smsTestResult.title}</ComposeText>
            </AlertDialog.Title>
            <AlertDialog.Text>
              <ComposeText color={theme.colors.textSecondary}>{smsTestResult.message}</ComposeText>
            </AlertDialog.Text>
            <AlertDialog.ConfirmButton>
              <TextButton onClick={() => setSmsTestResult(null)}>
                <ComposeText>确定</ComposeText>
              </TextButton>
            </AlertDialog.ConfirmButton>
          </AlertDialog>
        </Host>
      )}
    </>
  );
});
