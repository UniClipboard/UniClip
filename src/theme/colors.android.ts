/**
 * Android 色板 —— Material 3 Expressive(单一 M3 baseline,light + dark)
 *
 * 实现 ColorScheme 中性契约,值全部为 M3 十六进制。
 * 命名对照(中性名 ← 原 M3 token):
 *   textPrimary  ← onSurface / onBackground
 *   textSecondary← onSurfaceVariant
 *   accent*      ← primary*
 *   surface*     ← surfaceContainer*
 *   border       ← outline
 *   separator    ← outlineVariant
 *
 * Metro 在 Android 平台自动解析到本文件;iOS 走 colors.ios.ts;其它环境(jest/tsc/web)走 colors.ts。
 */

import type { ColorScheme } from './colors.types';

export { alpha, blend } from './colorUtils';
export type { ColorScheme, Color } from './colors.types';

// ------------------------------------------------------------------
// Source tokens(随深浅变化)
// ------------------------------------------------------------------

type SourceTokens = {
  accent: string;
  onAccent: string;
  accentContainer: string;
  onAccentContainer: string;
  background: string;
  surface: string;
  surfaceLowest: string;
  surfaceLow: string;
  surfaceMid: string;
  surfaceHigh: string;
  surfaceHighest: string;
  textSecondary: string;
  border: string;
  separator: string;
};

const SOURCE_LIGHT: SourceTokens = {
  accent: '#6750A4',
  onAccent: '#FFFFFF',
  accentContainer: '#EADDFF',
  onAccentContainer: '#21005D',
  background: '#FEF7FF',
  surface: '#FEF7FF',
  surfaceLowest: '#FFFFFF',
  surfaceLow: '#F7F2FA',
  surfaceMid: '#F3EDF7',
  surfaceHigh: '#ECE6F0',
  surfaceHighest: '#E6E0E9',
  textSecondary: '#49454F',
  border: '#79747E',
  separator: '#CAC4D0',
};

const SOURCE_DARK: SourceTokens = {
  accent: '#D0BCFF',
  onAccent: '#381E72',
  accentContainer: '#4F378B',
  onAccentContainer: '#EADDFF',
  background: '#141218',
  surface: '#141218',
  surfaceLowest: '#0F0D13',
  surfaceLow: '#1D1B20',
  surfaceMid: '#211F26',
  surfaceHigh: '#2B2930',
  surfaceHighest: '#36343B',
  textSecondary: '#CAC4D0',
  border: '#938F99',
  separator: '#49454F',
};

// ------------------------------------------------------------------
// Fixed tokens(不随 source 变化的语义/状态色)
// ------------------------------------------------------------------

const FIXED_LIGHT = {
  textPrimary: '#1D1B20',
  textTertiary: '#8E8E93',
  textDisabled: '#CAC4D0',

  error: '#B3261E',
  onError: '#FFFFFF',
  errorContainer: '#F9DEDC',
  onErrorContainer: '#410E0B',
  errorContainerBorder: '#F2B8B5',
  warning: '#FF9500',
  onWarning: '#FFFFFF',
  warningContainer: '#FFF4E5',
  onWarningContainer: '#8C5400',
  warningContainerBorder: '#FFE0B2',
  success: '#34C759',
  onSuccess: '#FFFFFF',
  successContainer: '#E6F4EA',
  onSuccessContainer: '#1B5E20',
  successContainerBorder: '#C8E6C9',
  info: '#5AC8FA',
  onInfo: '#FFFFFF',
  infoContainer: '#E3F2FD',
  onInfoContainer: '#0D47A1',
  infoContainerBorder: '#BBDEFB',

  inverseSurface: '#322F35',
  inverseOnSurface: '#F5EFF7',

  overlay: 'rgba(0, 0, 0, 0.3)',
  backdrop: 'rgba(0, 0, 0, 0.5)',

  messageSuccess: '#4CAF50',
  messageError: '#F44336',

  white: '#FFFFFF',
  transparent: 'transparent',

  fillPrimary: 'rgba(120, 120, 128, 0.20)',
  fillSecondary: 'rgba(120, 120, 128, 0.16)',
  fillTertiary: 'rgba(118, 118, 128, 0.12)',
  fillQuaternary: 'rgba(116, 116, 128, 0.08)',
};

const FIXED_DARK = {
  textPrimary: '#E6E0E9',
  textTertiary: '#8E8E93',
  textDisabled: '#49454F',

  error: '#F2B8B5',
  onError: '#601410',
  errorContainer: '#8C1D18',
  onErrorContainer: '#F9DEDC',
  errorContainerBorder: 'rgba(242, 184, 181, 0.35)',
  warning: '#FF9F0A',
  onWarning: '#000000',
  warningContainer: '#3B2A0F',
  onWarningContainer: '#FFD58A',
  warningContainerBorder: 'rgba(255, 159, 10, 0.35)',
  success: '#30D158',
  onSuccess: '#000000',
  successContainer: '#14331D',
  onSuccessContainer: '#A5D6A7',
  successContainerBorder: 'rgba(48, 209, 88, 0.35)',
  info: '#64D2FF',
  onInfo: '#000000',
  infoContainer: '#0F2A3B',
  onInfoContainer: '#90CAF9',
  infoContainerBorder: 'rgba(100, 210, 255, 0.35)',

  inverseSurface: '#E6E0E9',
  inverseOnSurface: '#322F35',

  overlay: 'rgba(255, 255, 255, 0.1)',
  backdrop: 'rgba(0, 0, 0, 0.7)',

  messageSuccess: '#4CAF50',
  messageError: '#F44336',

  white: '#FFFFFF',
  transparent: 'transparent',

  fillPrimary: 'rgba(120, 120, 128, 0.36)',
  fillSecondary: 'rgba(120, 120, 128, 0.32)',
  fillTertiary: 'rgba(118, 118, 128, 0.24)',
  fillQuaternary: 'rgba(116, 116, 128, 0.18)',
};

// ------------------------------------------------------------------
// Builders / exports
// ------------------------------------------------------------------

function composeScheme(s: SourceTokens, f: typeof FIXED_LIGHT): ColorScheme {
  return {
    textPrimary: f.textPrimary,
    textSecondary: s.textSecondary,
    textTertiary: f.textTertiary,
    textDisabled: f.textDisabled,

    accent: s.accent,
    onAccent: s.onAccent,
    accentContainer: s.accentContainer,
    onAccentContainer: s.onAccentContainer,

    background: s.background,
    surface: s.surface,
    surfaceLowest: s.surfaceLowest,
    surfaceLow: s.surfaceLow,
    surfaceMid: s.surfaceMid,
    surfaceHigh: s.surfaceHigh,
    surfaceHighest: s.surfaceHighest,

    border: s.border,
    separator: s.separator,

    error: f.error,
    onError: f.onError,
    errorContainer: f.errorContainer,
    onErrorContainer: f.onErrorContainer,
    errorContainerBorder: f.errorContainerBorder,
    success: f.success,
    onSuccess: f.onSuccess,
    successContainer: f.successContainer,
    onSuccessContainer: f.onSuccessContainer,
    successContainerBorder: f.successContainerBorder,
    warning: f.warning,
    onWarning: f.onWarning,
    warningContainer: f.warningContainer,
    onWarningContainer: f.onWarningContainer,
    warningContainerBorder: f.warningContainerBorder,
    info: f.info,
    onInfo: f.onInfo,
    infoContainer: f.infoContainer,
    onInfoContainer: f.onInfoContainer,
    infoContainerBorder: f.infoContainerBorder,

    inverseSurface: f.inverseSurface,
    inverseOnSurface: f.inverseOnSurface,

    overlay: f.overlay,
    backdrop: f.backdrop,
    messageSuccess: f.messageSuccess,
    messageError: f.messageError,
    white: f.white,
    transparent: f.transparent,

    fillPrimary: f.fillPrimary,
    fillSecondary: f.fillSecondary,
    fillTertiary: f.fillTertiary,
    fillQuaternary: f.fillQuaternary,
  };
}

export function buildScheme(isDark: boolean): ColorScheme {
  return isDark ? composeScheme(SOURCE_DARK, FIXED_DARK) : composeScheme(SOURCE_LIGHT, FIXED_LIGHT);
}

export const lightColors = buildScheme(false);
export const darkColors = buildScheme(true);
