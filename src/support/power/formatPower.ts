import type { TFunction } from 'i18next';

export const MINUTE_MS = 60_000;

export function formatPowerDuration(t: TFunction, ms: number): string {
  const total = Math.max(0, Math.round(ms / MINUTE_MS));
  if (total === 0) return t(ms > 0 ? 'power.duration.lessThanMinute' : 'power.duration.none', { ns: 'settingsAbout' });
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours === 0
    ? t('power.duration.minutes', { ns: 'settingsAbout', minutes })
    : t('power.duration.hours', { ns: 'settingsAbout', hours, minutes });
}

export function formatPowerBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
