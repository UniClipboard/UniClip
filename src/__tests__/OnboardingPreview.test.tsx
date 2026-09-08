import fs from 'fs';
import path from 'path';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { OnboardingPreviewScreen } from '@/screens/OnboardingPreviewScreen';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockGoBack = jest.fn();
let mockComplete: () => void;
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: mockGoBack }) }));
jest.mock('@/screens/OnboardingScreen', () => ({
  OnboardingScreen: ({ onComplete }: { onComplete: () => void }) => {
    mockComplete = onComplete;
    return null;
  },
}));

const source = (file: string) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');

describe('developer welcome preview entry', () => {
  it('returns to the previous screen on completion and can be opened repeatedly', () => {
    mockGoBack.mockClear();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let renderer: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(<OnboardingPreviewScreen />);
      });
      act(() => mockComplete());
      expect(mockGoBack).toHaveBeenCalledTimes(attempt + 1);
      act(() => renderer.unmount());
    }
    const preview = source('screens/OnboardingPreviewScreen.tsx');
    expect(preview).not.toContain('updateConfig');
    expect(preview).not.toContain('welcomeCompleted');
  });
  it('registers a separate preview route so previewing does not reset first-run state', () => {
    expect(source('navigation/AppNavigator.tsx')).toContain('name="OnboardingPreview"');
    expect(source('navigation/AppNavigator.types.ts')).toContain('OnboardingPreview: undefined');
  });
  it('uses the existing full-row controls on both platforms', () => {
    const android = source('screens/settings/android/DebugSection.tsx');
    const ios = source('screens/settings/ios/DeveloperPage.tsx');
    expect(android).toContain('clickable(onOpenOnboardingPreview)');
    expect(android).toContain("t('debug.onboardingPreview')");
    expect(ios).toMatch(/<SettingsNavRow[\s\S]*?onPress=\{onOpenOnboardingPreview\}/);
    expect(source('screens/SettingsScreen.ios.tsx')).toContain(
      "navigation.navigate('OnboardingPreview')"
    );
    expect(source('screens/settings/SettingsSubScreen.android.tsx')).toContain(
      "navigation.navigate('OnboardingPreview')"
    );
  });
});
