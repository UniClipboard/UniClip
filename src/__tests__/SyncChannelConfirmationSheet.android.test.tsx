import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { SyncChannelConfirmationSheet } from '@/screens/settings/SyncChannelConfirmationSheet.android';

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: { colors: { success: 'green' } } }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@expo/ui/jetpack-compose', () => ({ Text: 'Text' }));
jest.mock('@/components/ui', () => ({
  AppBottomSheet: 'AppBottomSheet',
  AppHost: 'AppHost',
  AppColumn: 'AppColumn',
  AppButton: 'AppButton',
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('gives the confirmation controls a Compose host inside the modal window', () => {
  let view: TestRenderer.ReactTestRenderer;
  act(() => {
    view = TestRenderer.create(
      <SyncChannelConfirmationSheet visible onDismiss={jest.fn()} onConfirm={jest.fn()} />
    );
  });
  try {
    const column = view!.root.findByType('AppColumn' as never);
    expect(column.parent?.type).toBe('AppHost');
    expect(column.parent?.parent?.type).toBe('AppBottomSheet');
    expect(column.parent?.props.matchContents).toEqual({ vertical: true });
    expect(column.parent?.props.style).toEqual({ width: '100%' });
  } finally {
    act(() => view.unmount());
  }
});
