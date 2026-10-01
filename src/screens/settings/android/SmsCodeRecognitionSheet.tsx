/**
 * 短信验证码识别测试底部表单(开发者选项)
 *
 * 输入模拟的短信正文,交给与真实短信接收链共用的原生识别器,只在屏幕上展示结果。
 * 不申请短信权限,不写剪贴板、历史,不同步、不上传;正文与结果不写日志或埋点。
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Column,
  ModalBottomSheet,
  Row,
  Spacer,
  Text as ComposeText,
  TextButton,
} from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  height as heightModifier,
  paddingAll,
  testID as testIDModifier,
  verticalScroll,
  width as widthModifier,
} from '@expo/ui/jetpack-compose/modifiers';
import {
  recognizeSmsVerificationCode,
  type SmsCodeRecognition,
} from 'sms-verification-code';
import { AppTextField } from '@/components/ui/AppTextField';
import { copyToLocalClipboard } from '@/utils/clipboard';

const TITLE_STYLE = { typography: 'titleLarge' } as const;

interface SmsCodeRecognitionSheetProps {
  onDismiss: () => void;
}

export function SmsCodeRecognitionSheet({
  onDismiss,
}: SmsCodeRecognitionSheetProps) {
  const { t } = useTranslation('settingsAbout');
  const [body, setBody] = useState('');
  const [result, setResult] = useState<SmsCodeRecognition | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const handleChangeBody = (next: string) => {
    setBody(next);
    setResult(null);
    setCopyStatus(null);
  };

  // 仅在用户明确点击时复制；走 copyToLocalClipboard 以复用自身写入排除，不产生历史记录
  const handleCopy = async () => {
    if (result?.status !== 'match') return;
    // 带上文本哈希，写入水位才能让剪贴板监听器把这次复制识别为自身写入
    const { clipboardManager } = await import('@/features/clipboard');
    const copied = await copyToLocalClipboard(await clipboardManager.buildTextContent(result.code));
    setCopyStatus(
      copied.success ? t('debug.smsCodeTest.copied') : t('debug.smsCodeTest.copyFailed')
    );
  };

  const resultText =
    result === null
      ? null
      : result.status === 'match'
      ? t('debug.smsCodeTest.recognized', { code: result.code })
      : result.status === 'ambiguous'
      ? t('debug.smsCodeTest.ambiguous')
      : t('debug.smsCodeTest.none');

  return (
    <ModalBottomSheet
      onDismissRequest={onDismiss}
      properties={{
        shouldDismissOnBackPress: true,
        shouldDismissOnClickOutside: true,
      }}
    >
      <Column modifiers={[fillMaxWidth(), verticalScroll(), paddingAll(24)]}>
        <ComposeText style={TITLE_STYLE}>
          {t('debug.smsCodeTest.title')}
        </ComposeText>
        <Spacer modifiers={[heightModifier(8)]} />
        <ComposeText>{t('debug.smsCodeTest.description')}</ComposeText>
        <Spacer modifiers={[heightModifier(16)]} />
        <AppTextField
          value={body}
          onChangeText={handleChangeBody}
          label={t('debug.smsCodeTest.inputLabel')}
          fullWidth
          testID="sms-code-test-input"
        />
        <Spacer modifiers={[heightModifier(16)]} />
        {resultText !== null ? (
          <ComposeText modifiers={[testIDModifier('sms-code-test-result')]}>
            {resultText}
          </ComposeText>
        ) : null}
        {copyStatus !== null ? (
          <ComposeText modifiers={[testIDModifier('sms-code-test-copy-status')]}>
            {copyStatus}
          </ComposeText>
        ) : null}
        <Spacer modifiers={[heightModifier(16)]} />
        <Row modifiers={[fillMaxWidth()]} horizontalArrangement="end">
          {result?.status === 'match' ? (
            <>
              <TextButton
                onClick={() => void handleCopy()}
                modifiers={[testIDModifier('sms-code-test-copy')]}
              >
                <ComposeText>{t('debug.smsCodeTest.copy')}</ComposeText>
              </TextButton>
              <Spacer modifiers={[widthModifier(8)]} />
            </>
          ) : null}
          <TextButton
            onClick={() => handleChangeBody('')}
            modifiers={[testIDModifier('sms-code-test-clear')]}
          >
            <ComposeText>{t('debug.smsCodeTest.clear')}</ComposeText>
          </TextButton>
          <Spacer modifiers={[widthModifier(8)]} />
          <TextButton onClick={onDismiss}>
            <ComposeText>{t('action.close', { ns: 'common' })}</ComposeText>
          </TextButton>
          <Spacer modifiers={[widthModifier(8)]} />
          <Button
            onClick={() => {
              setCopyStatus(null);
              setResult(recognizeSmsVerificationCode(body));
            }}
            modifiers={[testIDModifier('sms-code-test-run')]}
          >
            <ComposeText>{t('debug.smsCodeTest.run')}</ComposeText>
          </Button>
        </Row>
      </Column>
    </ModalBottomSheet>
  );
}
