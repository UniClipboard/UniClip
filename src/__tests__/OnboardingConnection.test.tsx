import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { OnboardingConnection } from '@/screens/onboarding/OnboardingConnection';
import type { useOnboardingConnection } from '@/screens/onboarding/useOnboardingConnection';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('@/components/ui', () => ({
  AppHost: ({ children }: { children: React.ReactNode }) => children,
  AppButton: (props: object) => require('react').createElement('button', props),
}));
jest.mock('@/screens/onboarding/OnboardingArtwork', () => ({ OnboardingArtwork: () => null }));
jest.mock(
  '@/screens/onboarding/OnboardingCloseButton',
  () => ({
    OnboardingCloseButton: (props: object) => require('react').createElement('close', props),
  }),
  { virtual: true }
);
jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: { colors: {} } }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it('reserves the bottom area for the primary action and separates rescan from dismissal', () => {
  const connection: ReturnType<typeof useOnboardingConnection> = {
    stage: 'confirm',
    intent: {
      name: 'Computer',
      urls: ['http://example.invalid'],
      username: 'phone',
      password: 'secret',
    },
    busy: false,
    error: null,
    scan: jest.fn(async () => undefined),
    connect: jest.fn(async () => undefined),
    close: jest.fn(),
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <OnboardingConnection
        connection={connection}
        onComplete={jest.fn()}
        finishing={false}
        completionError={false}
      />
    );
  });
  const footer = renderer.root.findByProps({ testID: 'connection-primary-action' });
  expect(footer.findAllByType('button' as React.ElementType)).toHaveLength(1);
  expect(footer.findByType('button' as React.ElementType).props.title).toBe('pairing.connect');
  const rescan = renderer.root
    .findAllByType('button' as React.ElementType)
    .find((node) => node.props.title === 'pairing.rescan')!;
  expect(rescan.props.variant).toBe('text');
  act(() => rescan.props.onPress());
  expect(connection.scan).toHaveBeenCalledTimes(1);
  act(() => renderer.root.findByType('close' as React.ElementType).props.onPress());
  expect(connection.close).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(renderer.toJSON())).not.toContain('secret');
  act(() => renderer.unmount());
});
