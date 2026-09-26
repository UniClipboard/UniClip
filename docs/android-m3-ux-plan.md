# Android Material 3 UX Remediation Plan

Status: implemented (type-check + unit tests green); on-device verification pending · Owner: mobile · Scope: Android only (iOS behavior must not change)

## Background

A design review of the Android UI found that most interaction patterns, feedback, motion,
and type tokens were copied from iOS, while only the color palette and the Compose-based
settings rows were genuinely Material 3. This plan fixes the findings in priority order.

Ground rules (from `AGENTS.md`):

- No `Platform.OS` checks in shared UI. Platform behavior differences in the shared home
  controller go through platform-resolved policy helpers (`*.android.ts` / `*.ios.ts`).
- Reuse existing components first; new Android-only components live under
  `src/components/android/`.
- Every behavior change gets a regression test (source-contract or render test, matching
  the existing test style).

## Phase 1 — Interaction semantics (P0)

| # | Change | Files |
|---|--------|-------|
| 1.1 | Replace the iOS-style top toast with an M3 **Snackbar**: bottom anchored, inverse surface, optional action button, longer hold for errors/actions, extended hold when a screen reader is on. `messageStore.showMessage` accepts an optional action. | `MessageToast.android.tsx`, `MessageToast.types.ts`, `messageStore.ts`, `ConnectedMessageToast.tsx` |
| 1.2 | **Undoable delete** on Android: delete hides items immediately and shows "Deleted · Undo"; the soft delete is committed when the snackbar expires. No confirmation dialog. iOS keeps its current immediate delete. | `historyDeleteMode.{android,ios}.ts` (replaces `confirmHistoryDelete.*`), `useUndoableHistoryDelete.ts`, `useHomeController.ts` |
| 1.3 | **Long-press enters selection mode** on Android (with haptic). The contextual top bar shows close, count, select-all, and — for a single selection — an overflow menu with the item's content actions. The "Select" pill is removed from the default top bar. iOS keeps the context-menu overlay. | `homeLongPressMode.{android,ios}.ts`, `useHomeController.ts`, `HomeTopBar.android.tsx`, `HomeTopBar.types.ts`, `HomeChrome.tsx` |
| 1.4 | ~~Enable **predictive back** (`predictiveBackGestureEnabled: true`).~~ Reverted: React Native 0.86 registers its back callback only on Android 16+, so on Android 13–15 the opt-in made system Back finish the activity instead of popping settings sub-pages. Android 16 enforces predictive back for targetSdk 36 regardless. | `app.json` |
| 1.5 | The launch **update prompt** becomes a non-blocking snackbar with an "Update" action. | `HomeView.android.tsx` |
| 1.6 | Analytics consent success/error feedback uses the settings snackbar instead of `Alert.alert`. | `AnalyticsConsentControl.android.tsx` |

## Phase 2 — Sheets (P1)

| # | Change | Files |
|---|--------|-------|
| 2.1 | `AppBottomSheet` gains a real **drag-to-dismiss** gesture so the drag handle is no longer a false affordance. | `AppBottomSheet.android.tsx` |
| 2.2 | `HistoryFilterSheet` reuses `AppBottomSheet` (no more sliding scrim); actions move to the bottom (text "Reset" + filled "Done"). | `HistoryFilterSheet.android.tsx` |
| 2.3 | Full-screen share page header follows M3: leading close, start-aligned title. | `ShareSendSheet.android.tsx` |

Compose `ModalBottomSheet` is kept where it already works (`AddSyncConnectionSheet`,
`LanServerEditorSheet`); `AppBottomSheet` exists because Compose sheets hosting RN
children measure unreliably, so the RN sheets are unified on `AppBottomSheet` instead.

## Phase 3 — Feedback & accessibility (P2)

| # | Change | Files |
|---|--------|-------|
| 3.1 | New Android-only `M3IconButton` (48dp target, borderless ripple, a11y label required). Used by the home top/bottom bars and page headers. | `src/components/android/M3IconButton.tsx` |
| 3.2 | Ripple on cards (replacing the iOS press-scale), chips, menu items, FAB, detail action bar. | `ClipboardCard.android.tsx`, `HomeFilterChipsRow.android.tsx`, `ClipboardDetailActionBar.android.tsx`, … |
| 3.3 | Touch targets ≥ 48dp; filter chips expose `radio` semantics; selection indicator uses a checkbox-style mark. | same |

## Phase 4 — Design tokens (P3, root cause)

| # | Change | Files |
|---|--------|-------|
| 4.1 | **Material You dynamic color**: the Android palette is read from `getMaterialColors()` (wallpaper on Android 12+, brand seed otherwise). Compose `Host`s use the same source via `MATERIAL_SEED_COLOR`, so RN and Compose surfaces match. | `colors.android.ts`, Android `Host` call sites |
| 4.2 | Replace iOS system colors in Android semantic roles (success / warning / info / tertiary text / hard-coded `#F44336`). | `colors.android.ts`, Android components |
| 4.3 | Add an M3 type scale (`m3Type`) and use it in the Android files touched by this plan; drop `iosDimensions` / `iosColors` from Android render paths. | `src/theme/m3Typography.ts`, Android components |

## Phase 5 — Details

| # | Change | Files |
|---|--------|-------|
| 5.1 | Remove trailing chevrons from settings navigation rows. | `SettingsScreen.android.tsx` |
| 5.2 | Remove the large spinner shown on every settings entry (blank surface until the Host mounts). | `SettingsScreen.android.tsx` |
| 5.3 | FAB follows the M3 FAB menu: 16dp corner, pill-shaped labelled items, no iOS icon tiles; "Sync now" leaves the add menu (pull-to-refresh already syncs). | `AddActionsFab.android.tsx` |
| 5.4 | Home default top bar becomes an M3 **Search bar** (leading search icon, hint text, trailing settings button); search mode uses a leading back arrow. The single-item overflow menu is removed. | `HomeTopBar.android.tsx` |

## Verification

- `npm run type-check` and `npx jest` after each phase.
- Regression tests added per change (see `src/__tests__/AndroidM3Ux.test.ts*`).
- Manual check on an Android device/emulator when available: long-press selection, undo
  delete, snackbar placement above the FAB, sheet drag-to-dismiss, system Back.

## Implementation notes

- Undo is a deferred commit, not a restore: soft delete also removes the local file
  directory, so the delete is committed only when the snackbar expires, is replaced by a
  newer message, the app goes to background, or the home screen unmounts.
- `HomeFilterChipsRow`'s date menu and `CardContextOverlay.android.tsx` remain RN overlays;
  the context overlay is no longer reachable on Android (long press selects) and can be
  removed once the Android E2E flows are confirmed on device.
- `.maestro` flows were updated for the new Android paths (long press selection, Undo
  snackbar, settings button in the search bar).
- A native rebuild is required for any `predictiveBackGestureEnabled` change to take effect.

## Out of scope / follow-ups

- Migrating every remaining literal `fontSize` in Android files to `m3Type` (only files
  touched here are migrated).
- A user-facing toggle for dynamic color.
- `AppTopSheet` has no consumers outside `src/components/ui` and is not an M3 component;
  consider deleting it.
- `HomeCompactView` (shared) still reads `iosColors` for its background; it resolves to the
  M3 background on Android but should move to a platform helper.
