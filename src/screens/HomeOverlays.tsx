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
          deviceName={c.wordPickerTarget.deviceName}
          onSendTo={c.openSendToText}
          onDismiss={() => c.setWordPickerTarget(null)}
        />
      )}

      {/* 全屏详情页:单击卡片 / 列表行、Android 多选溢出菜单「查看详情」打开(Compact / Expanded 共用) */}
      <ClipboardDetailModal
        visible={c.detailPageItem != null}
        onDismiss={c.closeDetailPage}
        c={c}
        item={c.detailPageItem}
      />

      {/* 「发送到」:把历史经同步通道发给所选设备(详情页、长按菜单、iOS 多选底栏)。由首页这层
          稳定宿主持有,盖在详情页之上。jobs 关闭后保留,供滑出动画渲染。 */}
      {c.sendToJobs ? (
        <ShareSendSheet
          visible={c.sendToVisible}
          jobs={c.sendToJobs}
          title={c.t('detail.sendTo')}
          onClose={c.closeSendTo}
        />
      ) : null}

      <CardContextOverlay
        item={c.contextItem}
        displayKind={c.contextDisplayKind}
        anchor={c.contextTarget?.anchor ?? null}
        actionGroups={c.actionMenuGroups}
        onDismiss={c.handleContextDismiss}
      />

      {/* 最后挂载,盖在 iOS 推入式详情页之上。Android Snackbar 与 iOS 底部玻璃提示都抬到
          右下 FAB(56 + 12 边距)/ 标签栏 / 多选底栏 / 详情工具栏之上 */}
      <ConnectedMessageToast bottomOffset={c.insets.bottom + 12 + 56 + 12} />
    </>
  );
}
