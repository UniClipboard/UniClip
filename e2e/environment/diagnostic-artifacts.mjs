import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { unzipSync, strFromU8 } from 'fflate';
import assert from 'node:assert/strict';
import { command } from './process.mjs';

// Read only exported files from the disposable device, never seed application data.
export async function captureDiagnosticArchives({ platform, id, appId, output }) {
  const destination = join(output, 'diagnostic-archives');
  await mkdir(destination, { recursive: true });
  const eligible = name => /^uniclip_diagnostics_[0-9_-]+\.zip$/.test(name);
  if (platform === 'ios') {
    const root = await command('xcrun', ['simctl', 'get_app_container', id, appId, 'data']);
    const cache = join(root, 'Library/Caches');
    for (const name of (await readdir(cache)).filter(eligible)) await cp(join(cache, name), join(destination, name));
  } else {
    const adb = join(process.env.ANDROID_HOME ?? join(homedir(), 'Library/Android/sdk'), 'platform-tools/adb');
    const names = (await command(adb, ['-s', id, 'shell', 'ls', '/sdcard/Documents'])).split(/\r?\n/).filter(eligible);
    for (const name of names) await command(adb, ['-s', id, 'pull', `/sdcard/Documents/${name}`, join(destination, name)]);
  }
  const names = (await readdir(destination)).filter(eligible);
  assert.ok(names.length > 0, 'No diagnostic archive exported by the UI');
  const pin = JSON.parse(await readFile(new URL('../../modules/uc-engine/core-source.json', import.meta.url), 'utf8'));
  for (const name of names) {
    const entries = unzipSync(await readFile(join(destination, name)));
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));
    const report = manifest.collection.engineLogs.exportReport;
    assert.equal(manifest.engineBuild.sourceRevision, pin.sourceCommit);
    assert.equal(report.flush, 'completed');
    assert.equal(report.status.capture.mode, 'standard');
    assert.equal(report.otherProcessesFlushed, false);
    assert.equal(report.status.counterScope, 'typed_events_only');
    assert.ok(report.files.some(source => source.writtenCount > 0));
    const logs = Object.entries(entries).filter(([file]) => file.startsWith('logs/engine/')).map(([, bytes]) => strFromU8(bytes)).join('\n');
    const records = logs.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return {}; } });
    assert.ok(new Set(records.map(record => record.run_id).filter(Boolean)).size >= 2, 'Restart did not preserve records from both Engine runs');
    assert.ok(logs.includes('host.network.changed') || logs.includes('host.lifecycle.changed'), 'No native host boundary in exported Engine records');
    assert.ok(logs.includes('diagnostics.export.snapshot'), 'No export snapshot in Engine records');
    assert.equal(manifest.coverage.complete, false);
    await writeFile(join(destination, `${name}.manifest.json`), JSON.stringify(manifest, null, 2));
  }
}
