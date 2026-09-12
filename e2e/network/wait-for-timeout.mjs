import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { command } from '../environment/process.mjs';

// Observe a real transport timeout before cancelling the still-retrying join through UI.
export async function waitForConnectionTimeout({ platform, id, output }) {
  const deadline = Date.now() + 75_000;
  while (Date.now() < deadline) {
    const logs = platform === 'ios'
      ? await command('xcrun', ['simctl', 'spawn', id, 'log', 'show', '--last', '2m', '--style', 'compact', '--predicate', 'subsystem == "app.uniclipboard" AND category == "engine" AND eventMessage CONTAINS "timed_out"'], { timeout: 15_000 })
      : await command(join(process.env.ANDROID_HOME ?? join(homedir(), 'Library/Android/sdk'), 'platform-tools/adb'), ['-s', id, 'logcat', '-d', '-v', 'brief', '-s', 'UcEngine'], { timeout: 15_000 });
    const evidence = logs.split('\n').filter(line => line.includes('connection.finished') && line.includes('timed_out') && line.includes('establish'));
    if (evidence.length) {
      await writeFile(join(output, 'connection-timeout-observed.txt'), evidence.join('\n'));
      return;
    }
    await delay(1_000);
  }
  throw new Error('No real connection establish timeout observed on the owned device');
}
