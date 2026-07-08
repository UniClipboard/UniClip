# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Platform-Specific Component Pattern

This project uses Metro's platform file resolution for all UI that differs between iOS and Android. **Never use `Platform.OS` conditionals inside a shared component.** Instead, split into platform files:

```
ComponentName.tsx           → export * from './ComponentName.android';
ComponentName.android.tsx   → Android implementation (M3 / Jetpack Compose)
ComponentName.ios.tsx        → iOS implementation (Liquid Glass / SwiftUI)
ComponentName.types.ts      → Shared props interface (imported by both platforms)
```

- The base `.tsx` re-exports from `.android` — this is the default/fallback.
- Metro automatically resolves `.ios.tsx` on iOS, so the base file is never loaded there.
- Shared props live in `.types.ts` to keep both implementations in sync.
- Each platform file owns its own styles (`StyleSheet.create`) — no shared style objects across platforms.

**iOS components** use:

- `@expo/ui/swift-ui` (Menu, Button, Host, BottomSheet, etc.) for native SwiftUI controls
- `expo-glass-effect` GlassView + `expo-blur` BlurView for Liquid Glass
- `GlassContainer` from `@/components/ui` (wraps the above with shape variants)
- `lucide-react-native` icons (closer to SF Symbols than Ionicons)
- `PlatformColor()` for system colors (systemGroupedBackground, etc.)
- `presentationStyle="pageSheet"` on Modal for native sheet presentation
- Design tokens from `@/theme/iosDesignTokens.ts`

**Android components** use:

- `@expo/ui/jetpack-compose` for native Compose controls
- Material Design 3 color tokens from `@/theme/colors.ts`
- `@expo/vector-icons/Ionicons` for icons
- Custom Modal with transparent backdrop for bottom sheets

Examples in the codebase:

- `src/components/HomeTopBar.{ios,android,types}.tsx`
- `src/components/HomeBottomBar.{ios,android,types}.tsx`
- `src/components/ServerSwitcherModal.{ios,android,types}.tsx`
- `src/components/ui/GlassContainer.{ios,tsx}`

# iOS Storage Compatibility

On iOS, this Expo app's local file cache **must be compatible** with the native Swift app at `<native-ios-repo>/UniClipboard`. Although the current bundle identifiers differ, they will be unified in the future. When implementing file/image caching on iOS:

- Use the same directory structure and naming conventions as the native iOS app.
- Do not invent a new cache layout that would conflict with or duplicate the native app's storage.
- Verify compatibility by checking the native app's `FileManager` / cache paths before making storage decisions.
