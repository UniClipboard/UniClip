#!/usr/bin/env node
// Extract safe stage records from one or more instrumented diagnostic archives.
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--out');
const output = outputIndex >= 0 ? args.splice(outputIndex, 2)[1] : undefined;
if (!output || args.length === 0) {
  console.error('Usage: node scripts/analyze-history-latency.mjs receiver.zip [sender.zip] --out output-directory');
  process.exit(2);
}
const records = [], archives = [];
for (const [index, input] of args.entries()) {
  const entries = unzipSync(fs.readFileSync(input));
  let manifest = null;
  const manifestBytes = entries['manifest.json'];
  if (manifestBytes) manifest = JSON.parse(strFromU8(manifestBytes));
  let malformed = 0;
  for (const [name, bytes] of Object.entries(entries)) {
    if (!name.startsWith('logs/app/')) continue;
    for (const line of strFromU8(bytes).split('\n')) {
      const marker = line.indexOf('history_latency {');
      if (marker < 0) continue;
      try {
        const record = JSON.parse(line.slice(marker + 'history_latency '.length));
        if (record.schemaVersion !== 1 || typeof record.sessionId !== 'string') { malformed++; continue; }
        records.push({ archive: index, log: name, ...record });
      } catch { malformed++; }
    }
  }
  archives.push({ archive: index, app: manifest?.app ?? null, engineBuild: manifest?.engineBuild ?? null,
    appCapture: manifest?.collection?.appLogs ?? null, coverage: manifest?.coverage ?? null, malformedRecords: malformed });
}
// Only order monotonic clocks inside the same JS process. Do not order devices by wall time.
records.sort((a, b) => a.archive - b.archive || a.sessionId.localeCompare(b.sessionId) || a.monotonicMs - b.monotonicMs);
const reads = new Map();
for (const record of records) {
  if (!record.readId) continue;
  const key = `${record.archive}:${record.sessionId}:${record.readId}`;
  if (!reads.has(key)) reads.set(key, []);
  reads.get(key).push(record);
}
const summaries = [...reads.values()].map(events => {
  const missing = [];
  const first = events.find(event => event.sourceEntryId) ?? events[0];
  if (!first.sourceEntryId) missing.push('Engine source entry identity unavailable; do not correlate by size or time alone');
  for (const stage of ['source_copy', 'sha256', 'sqlite_commit', 'history_viewable', 'history_frame_candidate']) {
    if (!events.some(event => event.stage === stage && (event.outcome === 'succeeded' || event.outcome === 'observed'))) missing.push(`${stage} successful boundary absent`);
  }
  return { archive: first.archive, sessionId: first.sessionId, readId: first.readId, sourceEntryId: first.sourceEntryId,
    stages: events.map(({ stage, outcome, durationMs, monotonicMs, timestamp, state }) => ({ stage, outcome, durationMs, monotonicMs, timestamp, state })),
    missingEvidence: missing };
});
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'timeline.jsonl'), records.map(record => JSON.stringify(record)).join('\n') + '\n');
const result = { schemaVersion: 1, archives, reads: summaries,
  limits: ['Frame candidates are JS observations, not pixel presentation proof.',
    'Cross-device wall-clock offset is not measured. Do not subtract sender and receiver clocks.',
    'Engine sourceEntryId comes only from the pinned default UUID cache layout; custom paths remain unmatched.',
    'Sender UI evidence requires the sender instrumented app archive; other senders remain unobserved.',
    'Read contexts expire after 10 minutes, 128 retained identities, or JS process restart.'],
  senderEvidencePresent: records.some(record => record.stage === 'sender_ui_state'),
  recordCount: records.length };
fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ output, records: records.length, reads: summaries.length, senderEvidencePresent: result.senderEvidencePresent }));
