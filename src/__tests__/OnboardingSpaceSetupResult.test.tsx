import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import type { AddSyncConnectionSheetProps } from '@/components/AddSyncConnectionSheet.types';
import type { SpaceSetupResultProps } from '@/screens/SpaceSetupResult.types';
import { OnboardingScreen } from '@/screens/OnboardingScreen';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let sheetProps: AddSyncConnectionSheetProps | null = null;
let resultProps: SpaceSetupResultProps | null = null;

jest.mock('@/components/AddSyncConnectionSheet', () => ({
  AddSyncConnectionSheet: (props: AddSyncConnectionSheetProps) => {
    sheetProps = props;
    return null;
  },
}));

jest.mock('@/screens/SpaceSetupResult', () => ({
  SpaceSetupResult: (props: SpaceSetupResultProps) => {
    resultProps = props;
    return null;
  },
}));

jest.mock('@/screens/onboarding/OnboardingPile', () => ({
  OnboardingPile: () => null,
}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        background: '#fff',
        textPrimary: '#111',
        textSecondary: '#666',
        accent: '#06f',
        onAccent: '#fff',
        border: '#ddd',
      },
    },
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('onboarding Space result flow', () => {
  let renderer: ReactTestRenderer | null = null;

  beforeEach(() => {
    sheetProps = null;
    resultProps = null;
  });

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('waits for the connection sheet to close before showing the result page', async () => {
    const onComplete = jest.fn(async () => undefined);
    act(() => {
      renderer = TestRenderer.create(<OnboardingScreen onComplete={onComplete} />);
    });

    expect(sheetProps).not.toBeNull();
    expect(resultProps).toBeNull();

    await act(async () => {
      await sheetProps?.onConnected?.();
    });
    expect(resultProps).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();

    act(() => sheetProps?.onClose());
    expect(resultProps).not.toBeNull();
    expect(onComplete).not.toHaveBeenCalled();

    await act(async () => {
      await resultProps?.onEnter();
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
