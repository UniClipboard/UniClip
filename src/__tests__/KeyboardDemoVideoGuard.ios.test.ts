// Dev clients built before expo-video was added have no ExpoVideo native
// module; importing expo-video there throws. The Keyboard page (and with it
// the whole Settings tab) must still load.

// Only module evaluation matters here: stand in for the SwiftUI bindings.
function mockAnyExport() {
  const fn = () => null;
  return new Proxy(
    { __esModule: true },
    {
      get: (target, key) =>
        key in target ? (target as Record<string | symbol, unknown>)[key] : fn,
    }
  );
}
jest.mock('@expo/ui/swift-ui', () => mockAnyExport());
jest.mock('@expo/ui/swift-ui/modifiers', () => mockAnyExport());
jest.mock('@/components/ui', () => mockAnyExport());
jest.mock('@/components/ui/iosButtonStyles.ios', () => mockAnyExport());
jest.mock('@/stores', () => mockAnyExport());
let mockExpoVideoModule: object | null = null;
jest.mock('expo', () => ({
  requireOptionalNativeModule: jest.fn(() => mockExpoVideoModule),
}));
jest.mock('expo-video', () => {
  throw new Error("Cannot find native module 'ExpoVideo'");
});
jest.mock('app-group-store', () => ({ getKeyboardStatus: jest.fn() }));
const mockPlayerLoaded = jest.fn();
jest.mock('../screens/settings/ios/KeyboardDemoVideoPlayer', () => {
  mockPlayerLoaded();
  return { KeyboardDemoVideoPlayer: () => null };
});

describe('Keyboard page without the ExpoVideo native module', () => {
  it('loads without touching expo-video', () => {
    expect(() => require('../screens/settings/ios/KeyboardPage')).not.toThrow();
    expect(require('expo').requireOptionalNativeModule).toHaveBeenCalledWith('ExpoVideo');
    expect(mockPlayerLoaded).not.toHaveBeenCalled();
  });

  it('loads the player when the native module exists', () => {
    jest.isolateModules(() => {
      mockExpoVideoModule = {};
      require('../screens/settings/ios/KeyboardPage');
    });
    expect(mockPlayerLoaded).toHaveBeenCalledTimes(1);
  });
});
