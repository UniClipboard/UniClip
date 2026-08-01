import React from 'react';
import { ConnectedMessageToast } from '@/components/ConnectedMessageToast';
import { HistoryFilterSheet } from '@/components/HistoryFilterSheet';
import { AddSyncConnectionSheet } from '@/components/AddSyncConnectionSheet';
import { MySpaceSheet } from '@/components/MySpaceSheet';
import { WordPickerOverlay } from '@/components/WordPickerOverlay';
import { CardContextOverlay } from '@/components/CardContextOverlay';
import type { HomeController } from './useHomeController';

/**
 * 首页的全部浮层/弹层集合。Compact 单栏与 Expanded 双栏共用——它们都是 Modal/绝对定位,
 * 不参与主体布局,放在一处避免两个布局各写一份。各浮层组件本身已按平台拆分。
 */
export function HomeOverlays({ c }: { c: HomeController }) {
  return (
    <>
      <ConnectedMessageToast />

      <HistoryFilterSheet
        visible={c.showFilterSheet}
        selectedKinds={c.selectedFilterKinds}
        selectedDate={c.selectedDateFilter}
        onToggleKind={c.handleToggleFilterKind}
        onSelectDate={c.setSelectedDateFilter}
        onClear={c.handleClearFilters}
        onClose={() => c.setShowFilterSheet(false)}
        theme={c.theme}
      />

      <AddSyncConnectionSheet
        visible={c.showAddConnection}
        initialMode="join"
        onClose={() => c.setShowAddConnection(false)}
        onConnected={c.handleP2pConnected}
      />

      <MySpaceSheet visible={c.showMySpace} onClose={() => c.setShowMySpace(false)} />

      {c.wordPickerTarget && (
        <WordPickerOverlay
          text={c.wordPickerTarget.text}
          anchor={c.wordPickerTarget.anchor}
          onDismiss={() => c.setWordPickerTarget(null)}
        />
      )}

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
