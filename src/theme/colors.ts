/**
 * 主题颜色 — Material 3 Expressive
 *
 * 设计原则:
 * 1. 以 M3 token 为正典(primary / primaryContainer / surfaceContainer* / outline 等)
 * 2. 单一 source color(M3 baseline,即 expo-ui 默认色),light + dark 各一份
 * 3. 状态色(error/warning/success/info)与 inverse surface 固定,不随深浅变化语义
 * 4. 保留旧 key 作为 alias(background/text/card/errorBackground 等),向下兼容仍在使用旧字段的屏幕
 *
 * 历史:曾内置 5 套可切换 palette,现已删除多色板系统,全局收敛为单一 M3 baseline。
 */

// ------------------------------------------------------------------
// Color helpers (exported — UI 层用于 hover/pressed/状态层着色)
// ------------------------------------------------------------------

export function alpha(hex: string, a: number): string {
  if (hex.startsWith('rgb')) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function blend(base: string, overlay: string, opacity: number): string {
  if (!base.startsWith('#') || !overlay.startsWith('#')) return base;
  const br = parseInt(base.slice(1, 3), 16);
  const bg = parseInt(base.slice(3, 5), 16);
  const bb = parseInt(base.slice(5, 7), 16);
  const or = parseInt(overlay.slice(1, 3), 16);
  const og = parseInt(overlay.slice(3, 5), 16);
  const ob = parseInt(overlay.slice(5, 7), 16);
  const r = Math.round(br * (1 - opacity) + or * opacity);
  const g = Math.round(bg * (1 - opacity) + og * opacity);
  const b = Math.round(bb * (1 - opacity) + ob * opacity);
  return `rgb(${r}, ${g}, ${b})`;
}

// ------------------------------------------------------------------
// Source tokens(单一 M3 baseline,light + dark)
// ------------------------------------------------------------------

type SourceTokens = {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  background: string;
  surface: string;
  surfaceContainerLowest: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  surfaceVariant: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;
};

const SOURCE_LIGHT: SourceTokens = {
  primary: '#6750A4',
  onPrimary: '#FFFFFF',
  primaryContainer: '#EADDFF',
  onPrimaryContainer: '#21005D',
  background: '#FEF7FF',
  surface: '#FEF7FF',
  surfaceContainerLowest: '#FFFFFF',
  surfaceContainerLow: '#F7F2FA',
  surfaceContainer: '#F3EDF7',
  surfaceContainerHigh: '#ECE6F0',
  surfaceContainerHighest: '#E6E0E9',
  surfaceVariant: '#E7E0EC',
  onSurfaceVariant: '#49454F',
  outline: '#79747E',
  outlineVariant: '#CAC4D0',
};

const SOURCE_DARK: SourceTokens = {
  primary: '#D0BCFF',
  onPrimary: '#381E72',
  primaryContainer: '#4F378B',
  onPrimaryContainer: '#EADDFF',
  background: '#141218',
  surface: '#141218',
  surfaceContainerLowest: '#0F0D13',
  surfaceContainerLow: '#1D1B20',
  surfaceContainer: '#211F26',
  surfaceContainerHigh: '#2B2930',
  surfaceContainerHighest: '#36343B',
  surfaceVariant: '#49454F',
  onSurfaceVariant: '#CAC4D0',
  outline: '#938F99',
  outlineVariant: '#49454F',
};

// ------------------------------------------------------------------
// Fixed tokens(不随 source 变化的语义/状态色)
// ------------------------------------------------------------------

const FIXED_LIGHT = {
  onBackground: '#1D1B20',
  onSurface: '#1D1B20',

  // M3 baseline secondary / tertiary(很少直接用,但保留)
  secondary: '#625B71',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#E8DEF8',
  onSecondaryContainer: '#1D192B',
  tertiary: '#7D5260',
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#FFD8E4',
  onTertiaryContainer: '#31111D',

  // 状态色
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

  // 叠加 / 背景遮罩
  overlay: 'rgba(0, 0, 0, 0.3)',
  backdrop: 'rgba(0, 0, 0, 0.5)',

  // 消息提示(Material Design 风)
  messageSuccess: '#4CAF50',
  messageError: '#F44336',

  // 杂项
  white: '#FFFFFF',
  transparent: 'transparent',

  // Fill 色阶(iOS 风,用于 hover/pressed 状态层)
  fillPrimary: 'rgba(120, 120, 128, 0.20)',
  fillSecondary: 'rgba(120, 120, 128, 0.16)',
  fillTertiary: 'rgba(118, 118, 128, 0.12)',
  fillQuaternary: 'rgba(116, 116, 128, 0.08)',

  // 三级文本灰(legacy 用)
  textTertiaryGray: '#8E8E93',
};

const FIXED_DARK = {
  onBackground: '#E6E0E9',
  onSurface: '#E6E0E9',

  secondary: '#CCC2DC',
  onSecondary: '#332D41',
  secondaryContainer: '#4A4458',
  onSecondaryContainer: '#E8DEF8',
  tertiary: '#EFB8C8',
  onTertiary: '#492532',
  tertiaryContainer: '#633B48',
  onTertiaryContainer: '#FFD8E4',

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

  textTertiaryGray: '#8E8E93',
};

type FixedTokens = typeof FIXED_LIGHT;

// ------------------------------------------------------------------
// Compose ColorScheme(M3 token + 派生 + legacy alias)
// ------------------------------------------------------------------

function composeScheme(s: SourceTokens, f: FixedTokens, isDark: boolean) {
  return {
    // === M3 source tokens ===
    primary: s.primary,
    onPrimary: s.onPrimary,
    primaryContainer: s.primaryContainer,
    onPrimaryContainer: s.onPrimaryContainer,
    background: s.background,
    surface: s.surface,
    surfaceContainerLowest: s.surfaceContainerLowest,
    surfaceContainerLow: s.surfaceContainerLow,
    surfaceContainer: s.surfaceContainer,
    surfaceContainerHigh: s.surfaceContainerHigh,
    surfaceContainerHighest: s.surfaceContainerHighest,
    surfaceVariant: s.surfaceVariant,
    onSurfaceVariant: s.onSurfaceVariant,
    outline: s.outline,
    outlineVariant: s.outlineVariant,

    // === M3 fixed tokens ===
    onBackground: f.onBackground,
    onSurface: f.onSurface,
    secondary: f.secondary,
    onSecondary: f.onSecondary,
    secondaryContainer: f.secondaryContainer,
    onSecondaryContainer: f.onSecondaryContainer,
    tertiary: f.tertiary,
    onTertiary: f.onTertiary,
    tertiaryContainer: f.tertiaryContainer,
    onTertiaryContainer: f.onTertiaryContainer,

    error: f.error,
    onError: f.onError,
    errorContainer: f.errorContainer,
    onErrorContainer: f.onErrorContainer,
    errorContainerBorder: f.errorContainerBorder,
    warning: f.warning,
    onWarning: f.onWarning,
    warningContainer: f.warningContainer,
    onWarningContainer: f.onWarningContainer,
    warningContainerBorder: f.warningContainerBorder,
    success: f.success,
    onSuccess: f.onSuccess,
    successContainer: f.successContainer,
    onSuccessContainer: f.onSuccessContainer,
    successContainerBorder: f.successContainerBorder,
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

    // === Legacy aliases —— 旧 key 指向最接近的 M3 token,让旧组件无感跟色 ===
    groupedBackground: s.background,
    elevatedSurface: s.surfaceContainerHigh,
    card: s.surfaceContainerLow,

    text: f.onSurface,
    textSecondary: s.onSurfaceVariant,
    textTertiary: f.textTertiaryGray,
    textDisabled: s.outlineVariant,

    border: s.outlineVariant,
    borderLight: s.outlineVariant,
    separator: alpha(f.onSurface, isDark ? 0.18 : 0.12),
    opaqueSeparator: s.outlineVariant,
    divider: s.outlineVariant,
    borderSubtle: alpha(f.onSurface, 0.08),

    primaryLight: blend(s.primary, '#FFFFFF', 0.3),
    primaryDark: blend(s.primary, '#000000', 0.2),
    secondaryLight: f.secondary,
    secondaryDark: f.secondary,

    active: s.primary,
    inactive: s.outlineVariant,
    disabled: s.surfaceContainerHigh,

    imagePlaceholder: s.surfaceContainerHigh,

    tabBarBackground: s.surface,
    tabBarBorder: s.outlineVariant,
    tabBarActive: s.primary,
    tabBarInactive: s.onSurfaceVariant,

    // 错误卡片(旧 key)— 指向 M3 errorContainer 语义
    errorBackground: f.errorContainer,
    errorBorder: f.errorContainerBorder,
    errorTitle: f.onErrorContainer,
    errorText: f.onErrorContainer,
  };
}

// ------------------------------------------------------------------
// Builders / exports
// ------------------------------------------------------------------

export function buildScheme(isDark: boolean): ColorScheme {
  const source = isDark ? SOURCE_DARK : SOURCE_LIGHT;
  const fixed = isDark ? FIXED_DARK : FIXED_LIGHT;
  return composeScheme(source, fixed, isDark);
}

export const lightColors = buildScheme(false);
export const darkColors = buildScheme(true);

export type ColorScheme = ReturnType<typeof composeScheme>;
