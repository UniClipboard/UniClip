---
name: UniClipboard
description: Cross-platform clipboard sync app — Material 3 Expressive on Android, Liquid Glass on iOS (26.x)

# ─── Android: Material 3 Expressive (Indigo default) ───────────────

android:
  colors:
    # Source tokens — vary by palette (indigo shown)
    primary: '#4A4FCF'
    on-primary: '#FFFFFF'
    primary-container: '#DEDFFF'
    on-primary-container: '#000F73'
    background: '#FBF8FF'
    surface: '#FBF8FF'
    surface-container-lowest: '#FFFFFF'
    surface-container-low: '#F4F1F9'
    surface-container: '#EEEBF3'
    surface-container-high: '#E9E6EE'
    surface-container-highest: '#E3E0E8'
    surface-variant: '#E3E1EC'
    on-surface: '#1D1B20'
    on-surface-variant: '#46464F'
    on-background: '#1D1B20'
    outline: '#767680'
    outline-variant: '#C7C5D0'
    # Fixed tokens
    secondary: '#625B71'
    on-secondary: '#FFFFFF'
    secondary-container: '#E8DEF8'
    on-secondary-container: '#1D192B'
    tertiary: '#7D5260'
    on-tertiary: '#FFFFFF'
    tertiary-container: '#FFD8E4'
    on-tertiary-container: '#31111D'
    error: '#B3261E'
    on-error: '#FFFFFF'
    error-container: '#F9DEDC'
    on-error-container: '#410E0B'
    warning: '#FF9500'
    warning-container: '#FFF4E5'
    on-warning-container: '#8C5400'
    success: '#34C759'
    success-container: '#E6F4EA'
    on-success-container: '#1B5E20'
    info: '#5AC8FA'
    info-container: '#E3F2FD'
    on-info-container: '#0D47A1'
    inverse-surface: '#322F35'
    inverse-on-surface: '#F5EFF7'
    overlay: 'rgba(0, 0, 0, 0.3)'
    backdrop: 'rgba(0, 0, 0, 0.5)'
    white: '#FFFFFF'

  colors-dark:
    primary: '#BCC2FF'
    on-primary: '#1A23A6'
    primary-container: '#333BB7'
    on-primary-container: '#DEDFFF'
    background: '#121318'
    surface: '#121318'
    surface-container-lowest: '#0D0E13'
    surface-container-low: '#1A1B21'
    surface-container: '#1F1F25'
    surface-container-high: '#29292F'
    surface-container-highest: '#34343A'
    surface-variant: '#46464F'
    on-surface: '#E6E0E9'
    on-surface-variant: '#C7C5D0'
    on-background: '#E6E0E9'
    outline: '#91909A'
    outline-variant: '#46464F'
    secondary: '#CCC2DC'
    secondary-container: '#4A4458'
    tertiary: '#EFB8C8'
    tertiary-container: '#633B48'
    error: '#F2B8B5'
    error-container: '#8C1D18'
    warning: '#FF9F0A'
    warning-container: '#3B2A0F'
    success: '#30D158'
    success-container: '#14331D'
    info: '#64D2FF'
    info-container: '#0F2A3B'
    inverse-surface: '#E6E0E9'
    inverse-on-surface: '#322F35'
    overlay: 'rgba(255, 255, 255, 0.1)'
    backdrop: 'rgba(0, 0, 0, 0.7)'
    white: '#FFFFFF'

  typography:
    large-title:
      fontFamily: system
      fontSize: 34px
      fontWeight: '700'
      lineHeight: 41px
      letterSpacing: 0.37px
    title1:
      fontFamily: system
      fontSize: 28px
      fontWeight: '700'
      lineHeight: 34px
      letterSpacing: 0.36px
    title2:
      fontFamily: system
      fontSize: 22px
      fontWeight: '700'
      lineHeight: 28px
      letterSpacing: 0.35px
    title3:
      fontFamily: system
      fontSize: 20px
      fontWeight: '600'
      lineHeight: 25px
      letterSpacing: 0.38px
    headline:
      fontFamily: system
      fontSize: 17px
      fontWeight: '600'
      lineHeight: 22px
      letterSpacing: -0.43px
    body:
      fontFamily: system
      fontSize: 17px
      fontWeight: '400'
      lineHeight: 22px
      letterSpacing: -0.43px
    callout:
      fontFamily: system
      fontSize: 16px
      fontWeight: '400'
      lineHeight: 21px
      letterSpacing: -0.32px
    subhead:
      fontFamily: system
      fontSize: 15px
      fontWeight: '400'
      lineHeight: 20px
      letterSpacing: -0.24px
    footnote:
      fontFamily: system
      fontSize: 13px
      fontWeight: '400'
      lineHeight: 18px
      letterSpacing: -0.08px
    caption1:
      fontFamily: system
      fontSize: 12px
      fontWeight: '400'
      lineHeight: 16px
    caption2:
      fontFamily: system
      fontSize: 11px
      fontWeight: '400'
      lineHeight: 13px
      letterSpacing: 0.07px
    section-header:
      fontFamily: system
      fontSize: 13px
      fontWeight: '600'
      lineHeight: 18px
      letterSpacing: 0.5px

  rounded:
    none: 0px
    xs: 4px
    sm: 8px
    md: 10px
    DEFAULT: 12px
    lg: 14px
    xl: 18px
    xxl: 24px
    pill: 999px

  spacing:
    unit: 4px
    none: 0px
    xxs: 2px
    xs: 4px
    sm: 8px
    md: 12px
    base: 16px
    lg: 20px
    xl: 24px
    xxl: 32px
    xxxl: 40px
    huge: 56px

  components:
    card:
      backgroundColor: '{android.colors.surface-container-low}'
      textColor: '{android.colors.on-surface}'
      rounded: '{android.rounded.DEFAULT}'
      padding: 16px
    bottom-sheet:
      backgroundColor: '{android.colors.surface}'
      rounded: '{android.rounded.xxl}'
      padding: 0 16px 32px
    action-row:
      rounded: '{android.rounded.DEFAULT}'
      padding: 14px 20px
    chip-default:
      backgroundColor: '{android.colors.surface}'
      textColor: '{android.colors.on-surface}'
      rounded: '{android.rounded.sm}'
      padding: 6px 10px
    chip-selected:
      backgroundColor: '{android.colors.primary}'
      textColor: '{android.colors.on-primary}'
      rounded: '{android.rounded.sm}'
      padding: 6px 10px
    button-primary:
      backgroundColor: '{android.colors.primary}'
      textColor: '{android.colors.on-primary}'
      rounded: '{android.rounded.md}'
      height: 48px
    button-outlined:
      backgroundColor: transparent
      textColor: '{android.colors.primary}'
      rounded: '{android.rounded.md}'
      height: 48px

# ─── iOS: Liquid Glass (iOS 26.x) ─────────────────────────────────

ios:
  colors:
    # iOS uses PlatformColor() at runtime — these are semantic names.
    # Light/dark adaptation is automatic via the system.
    label: PlatformColor("label")
    secondary-label: PlatformColor("secondaryLabel")
    tertiary-label: PlatformColor("tertiaryLabel")
    quaternary-label: PlatformColor("quaternaryLabel")
    system-background: PlatformColor("systemBackground")
    secondary-system-background: PlatformColor("secondarySystemBackground")
    system-grouped-background: PlatformColor("systemGroupedBackground")
    secondary-system-grouped-background: PlatformColor("secondarySystemGroupedBackground")
    tertiary-system-grouped-background: PlatformColor("tertiarySystemGroupedBackground")
    separator: PlatformColor("separator")
    tertiary-system-fill: PlatformColor("tertiarySystemFill")
    system-blue: '#007AFF'
    system-green: '#34C759'
    system-orange: '#FF9500'
    system-red: '#FF3B30'
    system-cyan: '#32ADE6'
    system-purple: '#AF52DE'

  accent:
    light: '#15171C'
    dark: '#F4F2EE'

  kind-tints:
    text: '#007AFF'
    url: '#32ADE6'
    image: '#34C759'
    file: '#FF9500'
    group: '#AF52DE'

  dimensions:
    floating-button-size: 52px
    sheet-filled-capsule-height: 48px
    action-bar-button-height: 44px
    min-tap-target: 44px
    card-corner-radius: 14px
    surface-corner-radius: 12px
    glass-card-radius: 18px
    grid-spacing: 12px
    screen-h-padding: 16px
    sheet-h-padding: 20px
    card-inner-padding: 12px
    panel-inner-padding: 14px
    grid-adaptive-min: 160px
    grid-adaptive-max: 210px

  rounded:
    sm: 8px
    DEFAULT: 12px
    lg: 14px
    xl: 18px
    xxl: 24px
    pill: 9999px

  components:
    glass-card:
      rounded: 18px
      padding: 12px
    sheet-header:
      typography: '{android.typography.headline}'
      padding: 20px 20px 12px
    chip-default:
      backgroundColor: PlatformColor("tertiarySystemFill")
      textColor: PlatformColor("label")
      rounded: '{ios.rounded.xl}'
      padding: 8px 12px
    chip-selected:
      backgroundColor: '{ios.accent}'
      textColor: DynamicColorIOS(light="#F4F2EE", dark="#15171C")
      rounded: '{ios.rounded.xl}'
      padding: 8px 12px
    context-menu-button:
      typography: '{android.typography.body}'
    page-sheet:
      backgroundColor: PlatformColor("systemBackground")

# ─── Shared elevation ──────────────────────────────────────────────

elevation:
  none:
    shadowOpacity: 0
    shadowRadius: 0px
    elevation: 0
  sm:
    shadowColor: '#000'
    shadowOffset: 0px 1px
    shadowOpacity: 0.05
    shadowRadius: 2px
    elevation: 1
  md:
    shadowColor: '#000'
    shadowOffset: 0px 2px
    shadowOpacity: 0.08
    shadowRadius: 8px
    elevation: 3
  lg:
    shadowColor: '#000'
    shadowOffset: 0px 8px
    shadowOpacity: 0.16
    shadowRadius: 24px
    elevation: 8

# ─── Shared motion ─────────────────────────────────────────────────

motion:
  duration:
    instant: 100ms
    fast: 180ms
    base: 240ms
    slow: 320ms
    slower: 480ms
  easing:
    standard: cubic-bezier(0.4, 0.0, 0.2, 1)
    accelerate: cubic-bezier(0.4, 0.0, 1, 1)
    decelerate: cubic-bezier(0.0, 0.0, 0.2, 1)
    emphasized: cubic-bezier(0.2, 0.0, 0.0, 1)
---

## Overview

UniClipboard is a cross-platform clipboard sync utility built with Expo / React Native. It runs on **Android** and **iOS** with fully platform-specific UI: Material Design 3 Expressive on Android, and Apple Liquid Glass on iOS (26.x).

The project follows a strict file-split pattern — every visual component has `.android.tsx` and `.ios.tsx` variants. Shared props live in `.types.ts`. Platform files own their own styles; there are no shared style objects across platforms.

The design personality is **utilitarian and quiet**: the UI stays out of the way so the user can glance at clipboard contents and act quickly. High information density, minimal decoration, fast gestures.

## Colors

### Android

The Android color system is **Material 3 Expressive** with five switchable source-color palettes: Indigo (default), Purple, Teal, Rose, and Amber. Each palette generates `primary`, `primaryContainer`, and five `surfaceContainer` tiers for both light and dark schemes.

- **Palette-varying tokens**: `primary`, `primaryContainer`, `surface*`, `outline`, `surfaceVariant` — these shift when the user picks a different palette.
- **Fixed tokens**: `error`, `warning`, `success`, `info`, `secondary`, `tertiary` — these stay constant across palettes and provide stable semantic meaning.
- **Legacy aliases** (`text`, `card`, `border`, `textSecondary`, etc.) map to the closest M3 token so older screens track the palette without manual updates.

Use `theme.colors.*` from the `useTheme()` hook. Never hard-code a hex value in an Android component.

### iOS

iOS does **not** use the M3 palette. Instead it relies on Apple's dynamic system colors via `PlatformColor()`, which automatically adapt to light/dark mode and accessibility settings.

- **Backgrounds**: `systemBackground`, `systemGroupedBackground`, and their secondary/tertiary variants.
- **Text**: `label`, `secondaryLabel`, `tertiaryLabel`, `quaternaryLabel`.
- **Fills**: `tertiarySystemFill` for chip and segment backgrounds.
- **Accent**: A custom `DynamicColorIOS` that provides the app's accent tint (`#15171C` light / `#F4F2EE` dark), exposed as `iosAccentColor`.
- **Kind tints**: Per-clipboard-type colors (`text → systemBlue`, `url → systemCyan`, `image → systemGreen`, `file → systemOrange`, `group → systemPurple`).

Use `PlatformColor()` for every system color. Use `iosAccentColor` from `iosDesignTokens.ts` for the app's primary tint. Never hard-code light/dark color pairs when a `PlatformColor` or `DynamicColorIOS` exists.

## Typography

Both platforms share the same type scale, aligned to iOS Human Interface Guidelines text styles. The font family is always the system default (San Francisco on iOS, Roboto on Android).

| Token           | Size | Weight | Line Height | Tracking |
| --------------- | ---- | ------ | ----------- | -------- |
| `largeTitle`    | 34   | 700    | 41          | 0.37     |
| `title1`        | 28   | 700    | 34          | 0.36     |
| `title2`        | 22   | 700    | 28          | 0.35     |
| `title3`        | 20   | 600    | 25          | 0.38     |
| `headline`      | 17   | 600    | 22          | −0.43    |
| `body`          | 17   | 400    | 22          | −0.43    |
| `callout`       | 16   | 400    | 21          | −0.32    |
| `subhead`       | 15   | 400    | 20          | −0.24    |
| `footnote`      | 13   | 400    | 18          | −0.08    |
| `caption1`      | 12   | 400    | 16          | 0        |
| `caption2`      | 11   | 400    | 13          | 0.07     |
| `sectionHeader` | 13   | 600    | 18          | 0.50     |

Access via `theme.typography.*`.

## Layout

- **Grid unit**: 4px. All spacing tokens are multiples of 4.
- **Screen padding**: 16px (Android and iOS).
- **Card inner padding**: 12px (iOS glass cards), 16px (Android M3 cards).
- **Grid spacing**: 12px between clipboard cards in the grid.
- **Sheet horizontal padding**: 20px.
- **Minimum tap target**: 44px (both platforms, following Apple HIG).

### iOS-specific grid

The clipboard card grid uses an adaptive column layout: each card is 160–210px wide, columns fill the available width, and the card is square (`cardSize × cardSize`).

## Elevation & Depth

### Android

Standard M3 elevation system with `elevation` prop for native Compose cards and `shadow*` props for RN views:

| Level | Use case          | `shadowRadius` | Android `elevation` |
| ----- | ----------------- | -------------- | ------------------- |
| none  | Flat elements     | 0              | 0                   |
| sm    | Static cards      | 2              | 1                   |
| md    | Floating cards    | 8              | 3                   |
| lg    | Modals / overlays | 24             | 8                   |

### iOS

iOS avoids traditional shadows in favor of the **Liquid Glass** material system:

- **Glass cards** use `expo-blur` `BlurView` (system chrome material tint) instead of opaque backgrounds with shadows.
- **Sheets** use the native `presentationStyle="pageSheet"` or `@expo/ui/swift-ui` `BottomSheet`.
- **Cards** that need shadow use the `iosCardShadow` token: `shadowOpacity: 0.06`, `shadowRadius: 5`.

## Shapes

### Android

| Element          | Radius | Token         |
| ---------------- | ------ | ------------- |
| Small chips      | 8px    | `radius.sm`   |
| Input fields     | 10px   | `radius.md`   |
| Cards            | 12px   | `radius.base` |
| Glass cards      | 18px   | `radius.xl`   |
| Bottom sheets    | 24px   | `radius.xxl`  |
| Pills / capsules | 999px  | `radius.pill` |

### iOS

| Element          | Radius | Notes                                        |
| ---------------- | ------ | -------------------------------------------- |
| Cards            | 14px   | `iosDimensions.cardCornerRadius`             |
| Glass cards      | 18px   | `iosDimensions.glassCardRadius`              |
| Surfaces         | 12px   | `iosDimensions.surfaceCornerRadius`          |
| Chips (capsule)  | 18px   | Capsule shape with `borderCurve: continuous` |
| Bottom sheet top | 20px   | Native page sheet handles this               |

All iOS radii should use `borderCurve: 'continuous'` for the native smooth-corner look.

## Components

### Platform file pattern

Every component that differs between platforms is split:

```
ComponentName.tsx           → re-exports from .android (default)
ComponentName.android.tsx   → Material 3 / Jetpack Compose
ComponentName.ios.tsx        → Liquid Glass / SwiftUI
ComponentName.types.ts      → Shared props interface
```

Metro resolves `.ios.tsx` on iOS automatically.

### Android components

- **Native controls**: `@expo/ui/jetpack-compose` — `Host`, `Card`, `Switch`, `Button`, `Text`.
- **Bottom sheets**: Custom `Modal` with transparent backdrop, slide animation, 75% screen height.
- **Action sheets**: `ClipboardCardActionSheet.android.tsx` — preview header + action rows.
- **Icons**: `@expo/vector-icons/Ionicons`.
- **Theme**: All colors from `useTheme().theme.colors.*`.

### iOS components

- **Native controls**: `@expo/ui/swift-ui` — `Host`, `ContextMenu`, `BottomSheet`, `Form`, `Section`, `Toggle`, `Button`, `Picker`.
- **Context menus**: `ContextMenu` with `ContextMenu.Preview` for native long-press menus on cards.
- **Sheets**: `presentationStyle="pageSheet"` on `Modal`, or `BottomSheet` from swift-ui with `presentationDetents`.
- **Glass effect**: `expo-blur` `BlurView` + `expo-glass-effect` `GlassView` wrapped by `GlassContainer`.
- **Icons**: `lucide-react-native` (closer to SF Symbols weight).
- **Theme**: `PlatformColor()` for system colors, `iosAccentColor` for app tint, `iosDesignTokens.ts` for dimensions.
- **Sheet header**: Reuse `SheetHeader` component (centered title, optional left/right actions).

## Do's and Don'ts

### Do

- Use `PlatformColor()` on iOS for every system semantic color.
- Use `useTheme().theme.colors.*` on Android for every color.
- Use `iosAccentColor` (from `iosDesignTokens.ts`) as the iOS primary tint.
- Split platform UI into `.android.tsx` / `.ios.tsx` files.
- Reuse existing `src/components/ui/` components before creating new ones.
- Use `borderCurve: 'continuous'` with all iOS radii ≥ 12px.
- Use `expo-haptics` for gesture feedback on iOS (Medium for anchoring, Light for sweep, Success for copy).
- Use green for Switch on-state track: `theme.colors.success` on Android, system default (green) on iOS.
- Check `iosDesignTokens.ts` dimensions before inventing new spacing values.

### Don't

- Don't use the primary/accent color for Switch on-state track. Switches follow platform convention: **green** (`success` on Android / system green on iOS) for the checked track.
- Don't pair `iosAccentColor` background with a fixed white text color — the accent is near-white in dark mode. Always use the inverse accent (`#F4F2EE` light / `#15171C` dark) as the text color on accent backgrounds.
- Don't hard-code hex colors in any component — derive from tokens or PlatformColor.
- Don't use `Platform.OS` conditionals inside a shared component; use platform files instead.
- Don't create shared style objects that both platforms import.
- Don't use `@expo/ui/swift-ui` on Android or `@expo/ui/jetpack-compose` on iOS.
- Don't use `Ionicons` on iOS (use `lucide-react-native`) or `lucide` on Android (use `Ionicons`).
- Don't invent new radius / spacing values — use the token scale.
- Don't skip the `SheetHeader` component when building an iOS sheet.
