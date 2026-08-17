# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Platform-Specific UI Pattern

Make platform ownership explicit, but only split at a real boundary. **Never use
`Platform.OS` conditionals inside a shared UI component.** Choose the smallest of
these three patterns:

1. **A UI component exists on both platforms and differs materially.** Use Metro
   platform files:

   ```
   ComponentName.tsx           → export * from './ComponentName.android';
   ComponentName.android.tsx   → Android implementation (M3 / Jetpack Compose)
   ComponentName.ios.tsx       → iOS implementation (Liquid Glass / SwiftUI)
   ComponentName.types.ts      → Shared props interface (imported by both platforms)
   ```

   The base `.tsx` re-exports Android as the default/fallback. Shared props live
   in `.types.ts`, and each platform file owns its own styles.

2. **A UI component or app entry exists on only one platform.** Put it directly
   under an explicit platform directory, such as `src/screens/settings/android/`
   or `src/app/android/`, and import it only from that platform's parent. Do not
   add an empty counterpart, a base re-export, or a fake shared component.

3. **A mostly shared UI has one small platform-specific policy or presentation
   difference.** Keep the shared UI in one file and put only the differing policy
   in a clearly named platform-resolved helper, for example
   `useSettingsScreenOptions.android.ts` and `useSettingsScreenOptions.ios.ts`.
   The shared UI may import that helper, but must not inspect the platform itself.
   Do not wrap the entire shared UI in `.android` / `.ios` files just to pass a
   small option object through another layer.

Do not create a `.shared.tsx` UI wrapper solely to satisfy file naming. Shared
logic belongs in ordinary shared hooks, services, or helpers; only extract it when
it has a meaningful reuse boundary.

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
- `src/components/AddSyncConnectionSheet.{ios,android,types}.tsx`
- `src/components/ui/GlassContainer.{ios,tsx}`

# UI Reuse Is Mandatory

Before implementing or changing any frontend UI, first inspect existing components in
`src/components/ui/`, the relevant platform's shared screen components, and nearby
same-purpose UI. If a reusable component already exists, use it.

- Do not create a one-off UI implementation when an existing component can represent
  the behavior with a small, coherent extension.
- Extend the existing component's platform-specific implementation for genuine variants
  such as destructive styling, disabled state, trailing content, or press behavior.
- Keep page code responsible only for the action taken after a press; shared layout,
  touch target, accessibility, and visual feedback belong in the reusable component.
- A new UI component is allowed only for materially distinct behavior with no suitable
  existing component. It must have a clear reuse boundary, not be an orphan copy of a
  nearby pattern.

# Full-Row Interaction Is Mandatory

When an action or navigation item is visually presented as a list/settings row, the
entire visible row must be interactive, including empty trailing space. A text label or
icon with only its intrinsic bounds tappable is not an acceptable row implementation.

- Reuse the platform's existing full-row component first. For iOS Settings-style pages,
  prefer `SettingsNavRow` and extend it coherently when a row needs a new variant such as
  no leading icon, destructive styling, disabled state, or no chevron.
- Do not place a bare intrinsic-size `Button` label inside a `Section` or `ListItem` when
  the surrounding layout reads as one tappable row.
- If a native custom row is necessary, its button content must expand to the available
  width and define a rectangular hit shape. Android row actions must likewise attach the
  click behavior to the full row rather than only to child text or icons.
- Before considering the UI complete, verify that tapping empty trailing space triggers
  the same action as tapping the label. Add or update a regression test that preserves
  full-row interaction and shared-component reuse.

# iOS Nested Sheet Ownership Is Mandatory

An iOS sheet or modal opened from an animated sub-page must be owned and rendered by the
nearest stable screen or `Host` that owns that sub-page. Render the sheet as a sibling of
the animated sub-page, never inside the sub-page itself. Otherwise presenting the sheet
can temporarily remove the sub-page and expose the stationary parent page underneath.

- The sub-page only reports the user's action through a callback. The stable parent owns
  the selected item, presentation state, and sheet component.
- Pass one shared controller/state object into the sub-page. Do not create a second
  controller in the sub-page or duplicate presentation state between parent and child.
- Reuse the existing `Host` and the established sibling-sheet pattern. In iOS Settings,
  use `SpaceInvitationSheet` in `SettingsScreen.ios.tsx` as the ownership reference.
- Do not place a React Native `Modal`, another `Host`, or a SwiftUI `BottomSheet` inside an
  animated Settings sub-page when the surrounding screen already provides a stable host.
- Add a regression check that asserts the sheet is rendered by the stable parent and not
  by the sub-page. Then verify the real transition on an iOS simulator frame by frame;
  the stationary parent page must never appear during sheet presentation or dismissal.

# iOS Storage Compatibility

On iOS, this Expo app's local file cache **must be compatible** with the native Swift app at `<native-ios-repo>/UniClipboard`. Although the current bundle identifiers differ, they will be unified in the future. When implementing file/image caching on iOS:

- Use the same directory structure and naming conventions as the native iOS app.
- Do not invent a new cache layout that would conflict with or duplicate the native app's storage.
- Verify compatibility by checking the native app's `FileManager` / cache paths before making storage decisions.
