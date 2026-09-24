import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { SyncChannelConfirmationSheet } from '@/screens/settings/SyncChannelConfirmationSheet.android';

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: { colors: { success: 'green' } } }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@expo/ui/jetpack-compose', () => ({
  ModalBottomSheet: 'ModalBottomSheet',
  Text: 'Text',
}));
jest.mock('@/components/ui', () => ({
  AppColumn: 'AppColumn',
  AppButton: 'AppButton',
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 弹层由设备页 Compose LazyColumn 里的 SyncChannelSection 渲染:必须是 Compose 原生
// ModalBottomSheet。RN Modal 作为 LazyColumn item 会被量成全屏高,关闭后向下滑动整页空白。
it('renders the confirmation controls in a Compose modal bottom sheet', () => {
  let view: TestRenderer.ReactTestRenderer;
  act(() => {
    view = TestRenderer.create(
      <SyncChannelConfirmationSheet visible onDismiss={jest.fn()} onConfirm={jest.fn()} />
    );
  });
  try {
    const column = view!.root.findByType('AppColumn' as never);
    expect(column.parent?.type).toBe('ModalBottomSheet');
  } finally {
    act(() => view.unmount());
  }
});

it('leaves nothing in the list while hidden', () => {
  let view: TestRenderer.ReactTestRenderer;
  act(() => {
    view = TestRenderer.create(
      <SyncChannelConfirmationSheet visible={false} onDismiss={jest.fn()} onConfirm={jest.fn()} />
    );
  });
  try {
    expect(view!.toJSON()).toBeNull();
  } finally {
    act(() => view.unmount());
  }
});

it('blocks dismissal while the switch is being saved', () => {
  const onDismiss = jest.fn();
  let view: TestRenderer.ReactTestRenderer;
  act(() => {
    view = TestRenderer.create(
      <SyncChannelConfirmationSheet
        visible
        isConfirming
        onDismiss={onDismiss}
        onConfirm={jest.fn()}
      />
    );
  });
  try {
    const sheet = view!.root.findByType('ModalBottomSheet' as never);
    expect(sheet.props.properties).toEqual({
      shouldDismissOnBackPress: false,
      shouldDismissOnClickOutside: false,
    });
    sheet.props.onDismissRequest();
    expect(onDismiss).not.toHaveBeenCalled();
  } finally {
    act(() => view.unmount());
  }
});
