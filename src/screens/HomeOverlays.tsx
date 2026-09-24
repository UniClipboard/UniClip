import React from 'react';
import { ConnectedMessageToast } from '@/components/ConnectedMessageToast';
import { ShareSendSheet } from '@/components/ShareSendSheet';
import { WordPickerOverlay } from '@/components/WordPickerOverlay';
import { CardContextOverlay } from '@/components/CardContextOverlay';
import { CameraCaptureSheet } from '@/components/CameraCaptureSheet';
import { ClipboardDetailModal } from '@/components/ClipboardDetailModal';
import { useShareSheetStore } from '@/stores/shareSheetStore';
import type { HomeController } from './useHomeController';

/**
 * 首页的全部浮层/弹层集合。Compact 单栏与 Expanded 双栏共用——它们都是 Modal/绝对定位,
 * 不参与主体布局,放在一处避免两个布局各写一份。各浮层组件本身已按平台拆分。
 */
export function HomeOverlays({ c }: { c: HomeController }) {
  const shareVisible = useShareSheetStore((s) => s.visible);
  return (
    <>
      {/* Android Snackbar 抬到右下 FAB(56 + 12 边距)/ 多选底栏之上;iOS 顶部 toast 忽略此值 */}
      <ConnectedMessageToast bottomOffset={c.insets.bottom + 12 + 56 + 12} />

      {/* Android 自绘相机页(iOS 恒不展示,走系统相机) */}
      <CameraCaptureSheet
        visible={c.cameraOpen}
        onClose={() => c.setCameraOpen(false)}
        onCapture={c.handleCameraCapture}
        theme={c.theme}
      />

      <ShareSendSheet
        visible={shareVisible}
        onClose={() => useShareSheetStore.getState().close()}
      />

      {c.wordPickerTarget && (
        <WordPickerOverlay
          text={c.wordPickerTarget.text}
          anchor={c.wordPickerTarget.anchor}
          onDismiss={() => c.setWordPickerTarget(null)}
        />
      )}

      {/* 多选溢出菜单「查看详情」打开的详情弹窗(Android 长按入口,Compact / Expanded 共用;
          iOS 走上下文浮层,不会打开) */}
      <ClipboardDetailModal
        visible={c.detailModalOpen}
        onDismiss={() => c.setDetailModalOpen(false)}
        c={c}
      />

      <CardContextOverlay
        item={c.contextItem}
        displayKind={c.contextDisplayKind}
        anchor={c.contextTarget?.anchor ?? null}
        actionGroups={c.actionMenuGroups}
        onDismiss={c.handleContextDismiss}
      />
    </>
  );
}
