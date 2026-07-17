/**
 * 设置分组容器:作为 LazyColumn 的单个 item。
 *
 * 顶层是单个 <Column>(ExpoComposeView),满足 @expo/ui LazyColumn「直接 child 必须是
 * Compose 组件」的硬约束(非 Compose 的 RN 节点会被原生侧静默跳过)。
 * 结构 = 分组标题 + Material Card(内含若干 ListItem 行,由调用方以 children 传入)。
 *
 * 颜色:标题用 M3 primary(Compose Text 在无 Surface 包裹时默认内容色是黑色,暗色
 * 模式下不可见,必须显式指定);Card 显式给 surface 容器色 + outlineVariant 边框,
 * 保证暗色下卡片边界与背景有对比。色板经 useMaterialColors() 读取所在 <Host> 的
 * 主题(跟随 Host 的 colorScheme)。
 */
import { memo, type ReactNode } from 'react';
import {
  Card,
  Column,
  Spacer,
  Text as ComposeText,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import { fillMaxWidth, height as heightModifier } from '@expo/ui/jetpack-compose/modifiers';

interface SettingsSectionItemProps {
  title: string;
  children: ReactNode;
  footer?: string;
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
  footer,
  dialogs,
}: SettingsSectionItemProps) {
  const colors = useMaterialColors();

  return (
    <Column modifiers={[fillMaxWidth()]}>
      <ComposeText
        color={colors.primary}
        style={{ fontSize: 13, fontWeight: '600', letterSpacing: 0 }}
      >
        {title}
      </ComposeText>
      <Spacer modifiers={[heightModifier(8)]} />
      {/* containerColor 与 ListItem 默认容器色(surface)一致,避免行与卡片色不一致的拼块感 */}
      <Card
        colors={{ containerColor: colors.surface }}
        border={{ width: 1, color: colors.outlineVariant }}
      >
        <Column modifiers={[fillMaxWidth()]}>{children}</Column>
      </Card>
      {footer ? (
        <>
          <Spacer modifiers={[heightModifier(6)]} />
          <ComposeText color={colors.onSurfaceVariant} style={{ fontSize: 12 }}>
            {footer}
          </ComposeText>
        </>
      ) : null}
      {dialogs}
    </Column>
  );
});
