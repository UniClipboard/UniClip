import { setTimeout as delay } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import assert from 'node:assert/strict';
import { desktopPeer } from './desktop-peer.mjs';
import { command } from '../environment/process.mjs';

export async function runDiagnosticLifecycle({ cli, output, runFlow, platform, id }) {
  const peer = desktopPeer(cli, output);
  try {
    const code = await peer.prepare();
    await runFlow('join', { INVITATION_CODE: code, SPACE_PASSWORD: peer.passphrase });
    await runFlow('diagnostic-start', {});
    await runFlow('diagnostic-background-enable', {});
    if (platform === 'android') {
      const dump = await command(join(process.env.ANDROID_HOME ?? join(homedir(), 'Library/Android/sdk'), 'platform-tools/adb'), ['-s', id, 'shell', 'dumpsys', 'activity', 'services', 'app.uniclipboard.android.dev']);
      await writeFile(join(output, 'background-service-state.txt'), dump);
      assert.ok(dump.includes('SyncForegroundService') && dump.includes('isForeground=true'), 'The foreground service was not actually running');
    }
    await runFlow('diagnostic-background', {});
    await delay(10_000);
    await peer.send('BackgroundCoverageProbe', 'background', { allowDeferred: true });
    await runFlow('diagnostic-resume', {});
    await runFlow('exchange', { INCOMING: 'BackgroundCoverageProbe', OUTGOING: 'LifecycleReplyProbe' });
    await peer.expectReceived('LifecycleReplyProbe', 'resumed');
    await runFlow('export', {});
  } finally { await peer.dispose(); }
}
