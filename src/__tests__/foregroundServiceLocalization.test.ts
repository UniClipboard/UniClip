import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const moduleRoot = join(process.cwd(), 'modules', 'foreground-service', 'android', 'src', 'main');
const servicePath = join(
  moduleRoot,
  'java',
  'expo',
  'modules',
  'foregroundservice',
  'SyncForegroundService.kt'
);

const expectedStrings = {
  foreground_service_channel_name: ['Background tasks', '后台任务'],
  foreground_service_channel_description: [
    'UniClip background sync service',
    'UniClip 后台同步服务',
  ],
  foreground_service_running: ['Background tasks running', '后台任务运行中'],
  foreground_service_stopping: ['Stopping…', '正在停止…'],
  foreground_service_action_temp_stop: ['Pause', '临时停止'],
  foreground_service_action_stop: ['Stop', '永久停止'],
  foreground_service_restart_channel_name: ['Background service alerts', '后台服务提醒'],
  foreground_service_restart_channel_description: [
    'Alerts when the background service is stopped by the system',
    '后台服务被系统终止后的提醒',
  ],
  foreground_service_restart_title: ['Background service stopped', '后台服务已停止'],
  foreground_service_restart_content: ['Tap to resume background service', '点击恢复后台服务'],
  foreground_service_timeout_content: [
    'Android limits background tasks to 6 hours within 24 hours after the app is closed. Tap to restart.',
    '系统限制后台任务在主界面关闭后 24 小时内最多运行 6 小时，点击重新启动。',
  ],
} as const;

function readStrings(qualifier: 'values' | 'values-zh'): string {
  return readFileSync(join(moduleRoot, 'res', qualifier, 'strings.xml'), 'utf8');
}

describe('Android foreground service localization', () => {
  it('defines complete English and Simplified Chinese notification text', () => {
    const english = readStrings('values');
    const chinese = readStrings('values-zh');

    for (const [key, [englishText, chineseText]] of Object.entries(expectedStrings)) {
      expect(english).toContain(`<string name="${key}">${englishText}</string>`);
      expect(chinese).toContain(`<string name="${key}">${chineseText}</string>`);
    }
  });

  it('loads every user-visible notification string from Android resources', () => {
    const source = readFileSync(servicePath, 'utf8');

    for (const key of Object.keys(expectedStrings)) {
      expect(source).toContain(`R.string.${key}`);
    }

    expect(source).not.toMatch(/"[^"\n]*[\u3400-\u9fff][^"\n]*"/u);
  });

  it('refreshes notification channels and the active notification after a locale change', () => {
    const source = readFileSync(servicePath, 'utf8');

    expect(source).toContain('override fun onConfigurationChanged(newConfig: Configuration)');
    expect(source).toContain('createNotificationChannels()');
    expect(source).toContain(
      'notificationManager?.notify(NOTIFY_ID, createNotification(lastContent))'
    );
  });
});
