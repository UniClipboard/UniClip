import fs from 'fs';
import path from 'path';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ConnectionPreviewScreen } from '@/screens/ConnectionPreviewScreen';
import type { useOnboardingConnection } from '@/screens/onboarding/useOnboardingConnection';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockBack = jest.fn();
let mockProps: { connection: ReturnType<typeof useOnboardingConnection>; onComplete: () => void };
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: mockBack }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/screens/onboarding/OnboardingConnection', () => ({
  OnboardingConnection: (props: typeof mockProps) => {
    mockProps = props;
    return null;
  },
}));

const source = (file: string) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');

describe('connection preview entry', () => {
  it('previews confirmation and success without invoking the real connection workflow', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<ConnectionPreviewScreen />);
    });
    expect(mockProps.connection.stage).toBe('confirm');
    expect(mockProps.connection.intent?.urls[0]).toContain('example.invalid');
    await act(async () => mockProps.connection.connect());
    expect(mockProps.connection.stage).toBe('success');
    act(() => mockProps.onComplete());
    expect(mockBack).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
    const preview = source('screens/ConnectionPreviewScreen.tsx');
    expect(preview).not.toContain('useOnboardingConnection');
    expect(preview).not.toContain('connectLanFromQr');
  });
  it('registers a separate screen and opens it from full rows on both platforms', () => {
    expect(source('navigation/AppNavigator.tsx')).toContain('name="ConnectionPreview"');
    expect(source('screens/settings/android/DebugSection.tsx')).toContain(
      'clickable(onOpenConnectionPreview)'
    );
    expect(source('screens/settings/ios/DeveloperPage.tsx')).toMatch(
      /<SettingsNavRow[\s\S]*?onPress=\{onOpenConnectionPreview\}/
    );
  });
});
