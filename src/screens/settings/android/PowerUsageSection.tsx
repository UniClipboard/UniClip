/**
 * 电量与后台活动分组(Android「诊断日志」二级页)
 *
 * 展示最近 24 小时的期间概览:应用内 / 后台亮屏 / 后台熄屏三种状态下的时长、本应用 CPU 与
 * 网络量,以及整机电量变化。整机电量与本应用的活动量分开呈现,脚注说明 Android 不提供
 * 逐应用耗电,精确耗电不可得时明确写「不可用」而不是 0。统计只在本机,导出日志时一并带出。
 * 行全部复用 SettingsListRow;「重置统计」是整行可点的动作行。
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { formatPowerBytes, formatPowerDuration, MINUTE_MS } from '@/support/power/formatPower';
import { usePowerOverview } from '@/support/power/usePowerOverview';
import type { PowerOverview, PowerStateOverview } from '@/support/power/powerOverview';
import { useSettingsToast } from '../SettingsToastContext';
import { SettingsSectionItem } from '../SettingsSectionItem';
import { SettingsListRow } from './SettingsListRow';

/** CPU time is usually seconds, so small values are not rounded to 0 minutes. */
function formatPowerCpu(t: TFunction, ms: number): string {
  return ms < MINUTE_MS ? `${Math.max(1, Math.round(ms / 1000))} s` : formatPowerDuration(t, ms);
}

function stateDescription(t: TFunction, state: PowerStateOverview): string {
  const unavailable = t('power.unknownValue', { ns: 'settingsAbout' });
  return t('power.stateDetail', {
    ns: 'settingsAbout',
    duration: formatPowerDuration(t, state.durationMs),
    cpu: state.cpuMs === null ? unavailable : formatPowerCpu(t, state.cpuMs),
    network: state.networkBytes === null ? unavailable : formatPowerBytes(state.networkBytes),
  });
}

function batteryDescription(t: TFunction, battery: PowerOverview['battery']): string {
  const key = `power.battery.${battery.state}`;
  const change = battery.levelDeltaPct === null ? '' : String(battery.levelDeltaPct);
  return t(key, { ns: 'settingsAbout', change, duration: formatPowerDuration(t, battery.coverageMs) });
}

export const PowerUsageSection = memo(function PowerUsageSection() {
  const { t } = useTranslation('settingsAbout');
  const showMessage = useSettingsToast();
  const { state, reset } = usePowerOverview();

  const handleReset = async () => {
    showMessage(t(await reset() ? 'power.resetDone' : 'power.resetFailed'), 'info');
  };

  if (state.status !== 'ready') {
    return (
      <SettingsSectionItem variant="grouped" title={t('power.title')} footer={t('power.footer')}>
        <SettingsListRow
          key="status"
          testID="power-usage-status"
          title={t('power.period')}
          description={t(state.status === 'loading' ? 'power.loading' : 'power.unavailable')}
        />
      </SettingsSectionItem>
    );
  }

  const { overview, hasSamples } = state;
  return (
    <SettingsSectionItem variant="grouped" title={t('power.title')} footer={t('power.footer')}>
      {hasSamples && overview.coveredMs > 0
        ? overview.states.map((entry) => (
            <SettingsListRow
              key={entry.key}
              testID={`power-usage-${entry.key}`}
              title={t(`power.state.${entry.key}`)}
              description={stateDescription(t, entry)}
            />
          ))
        : [<SettingsListRow key="empty" testID="power-usage-empty" title={t('power.period')} description={t('power.collecting')} />]}
      <SettingsListRow
        key="battery"
        testID="power-usage-battery"
        title={t('power.battery.title')}
        description={batteryDescription(t, overview.battery)}
      />
      <SettingsListRow
        key="service"
        testID="power-usage-service"
        title={t('power.service.title')}
        description={t('power.service.detail', {
          duration: formatPowerDuration(t, overview.serviceMs),
          events: overview.engineEventCount,
        })}
      />
      {overview.uncoveredMs >= MINUTE_MS ? (
        <SettingsListRow
          key="gap"
          testID="power-usage-gap"
          title={t('power.period')}
          description={t('power.gap', { duration: formatPowerDuration(t, overview.uncoveredMs) })}
        />
      ) : null}
      <SettingsListRow
        key="reset"
        testID="power-usage-reset"
        title={t('power.reset')}
        trailing={{ action: t('power.resetAction') }}
        onPress={() => void handleReset()}
      />
    </SettingsSectionItem>
  );
});
