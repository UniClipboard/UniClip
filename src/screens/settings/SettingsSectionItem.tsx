/**
 * 设置分组容器:作为 LazyColumn 的单个 item。
 *
 * 顶层是单个 <Column>(ExpoComposeView),满足 @expo/ui LazyColumn「直接 child 必须是
 * Compose 组件」的硬约束(非 Compose 的 RN 节点会被原生侧静默跳过)。
 * 结构 = 分组标题 + Material Card(内含若干 ListItem 行,由调用方以 children 传入)。
 */
import React, { memo, type ReactNode } from 'react';
import { Card, Column, Spacer, Text as ComposeText } from '@expo/ui/jetpack-compose';
import { fillMaxWidth, height as heightModifier } from '@expo/ui/jetpack-compose/modifiers';

interface SettingsSectionItemProps {
  title: string;
  children: ReactNode;
  /**
   * 可选:该分组的弹窗(AlertDialog / ModalBottomSheet)。作为 item 内的 overlay 渲染——
   * Compose Dialog 是 window 级 overlay,不占列表布局,且弹窗打开时 item 必在视口(modal
   * 挡住背景、无法滚动),不会被 LazyColumn 回收,因此无需把弹窗状态外提到页面级。
   */
  dialogs?: ReactNode;
}

export const SettingsSectionItem = memo(function SettingsSectionItem({
  title,
  children,
  dialogs,
}: SettingsSectionItemProps) {
  return (
    <Column modifiers={[fillMaxWidth()]}>
      <ComposeText style={{ fontSize: 13, fontWeight: '600', letterSpacing: 0.6 }}>
        {title}
      </ComposeText>
      <Spacer modifiers={[heightModifier(8)]} />
      <Card>
        <Column modifiers={[fillMaxWidth()]}>{children}</Column>
      </Card>
      {dialogs}
    </Column>
  );
});
