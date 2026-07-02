import React, { useCallback } from 'react';
import { Share } from 'react-native';
import {
  Button as SwiftUIButton,
  Label,
  LabeledContent,
  Section,
  Text as SwiftUIText,
} from '@expo/ui/swift-ui';
import { foregroundStyle } from '@expo/ui/swift-ui/modifiers';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import { GuideStepRow, HeaderCircleButton } from './common';

/**
 * Share-extension guide. The extension itself needs no switch — it is
 * available as soon as the app is installed — but iOS gives no API to pin it
 * to the share sheet's favorites, so this page walks the user through doing
 * it by hand, with a button that opens a real share sheet to practice on.
 */
export function SharePage({ onBack }: { onBack: () => void }) {
  const handleTryShare = useCallback(() => {
    Share.share({ message: '来自 UniClip 的分享测试 👋' }).catch(() => {
      // user dismissed the sheet — nothing to do
    });
  }, []);

  return (
    <IosSheetPage
      title="分享"
      leftSlots={[<HeaderCircleButton key="back" systemName="chevron.left" onPress={onBack} />]}
    >
      <IosSheetForm>
        {/* ── 说明 ── */}
        <Section
          footer={
            <SwiftUIText>
              在任意 App
              里点「分享」，选择「UniClip」，即可把内容直接推送到你的剪贴板服务器——无需先复制再切回
              UniClip。
            </SwiftUIText>
          }
        >
          <LabeledContent label={<Label title="支持内容" systemImage="square.and.arrow.up" />}>
            <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
              文本 · 链接 · 图片 · 文件
            </SwiftUIText>
          </LabeledContent>
        </Section>

        {/* ── 设为常用 ── */}
        <Section
          header={<SwiftUIText>设为常用</SwiftUIText>}
          footer={
            <SwiftUIText>
              加入「个人收藏」后，UniClip 会固定出现在分享面板 App 列表的最前排。
            </SwiftUIText>
          }
        >
          <GuideStepRow index={1} text="打开任意分享面板（可点下方按钮）" />
          <GuideStepRow index={2} text="App 图标一排滑到最右，点「更多」" />
          <GuideStepRow index={3} text="点右上角「编辑」，用 ➕ 把 UniClip 加入个人收藏" />
          <GuideStepRow index={4} text="拖动到最前，点「完成」" />
        </Section>

        <Section>
          <SwiftUIButton
            systemImage="square.and.arrow.up"
            label="打开分享面板试一试"
            onPress={handleTryShare}
          />
        </Section>
      </IosSheetForm>
    </IosSheetPage>
  );
}
