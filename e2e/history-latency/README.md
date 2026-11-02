# History latency evidence

The app records the receive-to-history path at the `info` log level. The existing diagnostic export includes these records under `logs/app/`. Each record starts with `history_latency ` and contains one JSON object. PostHog does not accept the `HistoryLatency` source. The change adds no telemetry destination.

## Identity and clocks

- `sessionId` identifies one JS process lifetime. `readId` identifies one file read.
- `file_identity.sourceEntryId` is the source entry UUID from the file actually copied. The pinned Engine uses `iroh-blobs/<source-entry-uuid>/` for its default file receive cache. Join this UUID to the Engine materialization record's `fields.entry_id`. That source ID can differ from the receiver's local entry ID.
- Early copy records can have a null source ID. Join them through `readId` to the later identity record. The initial clipboard URL can change before the copy, so it is not used as proof of the copied file's identity.
- Custom receive paths remain unmatched. Do not infer an entry ID from a filename, file size, or nearby timestamp.
- `diagnosticReadId` travels through in-memory clipboard and history objects. The existing SQLite row mapper does not persist this field. The registry uses full SHA-256 values only for in-memory lookup. Latency records exclude those values.
- The registry retains at most 128 reads for 10 minutes. A process restart clears the registry. If a reloaded row has two or more matching reads, the registry returns no match. It never chooses a duplicate read by timestamp.
- `timestamp` records UTC occurrence time before the asynchronous log transport writes. `monotonicMs` and `durationMs` measure the current JS process. Never subtract monotonic clocks from different processes.
- iOS Engine events include the native bridge return wall time and native uptime. These fields do not measure Engine emission. Compare native return and JS consumption within one device, allowing for wall-clock changes. Android and older native builds can omit these fields.

The latency record contains no file path, filename, preview, bytes of content, full content hash, peer ID, or device name. Entry and attempt IDs are diagnostic identities already present in Engine logs.

## Boundaries

| Stage | Meaning |
| --- | --- |
| `monitor_started` | Polling starts; `delayMs` is the configured polling interval. |
| `file_read` | A new file read starts or finishes content preparation. |
| `source_copy` | The clipboard proxy reads the source and copies it to a temporary file. The duration includes the proxy call. |
| `file_identity` | The app identifies the copied source or marks it unmatched. |
| `sha256` | The existing file hash call starts, succeeds, or fails. `state` identifies JS or native hashing. `bytes` records file size. |
| `history_lookup` | The existing row lookup starts, succeeds, or fails. |
| `monitor_persist` | The monitor compares content, persists its hash, and schedules notification. |
| `debounce` | The monitor schedules notification with its configured delay, or another content notification replaces it. |
| `monitor_callback` | The debounce fires. Its duration measures actual scheduling delay. |
| `monitor_discarded` | A monitor generation change discards the read. |
| `history_admission` | History admission starts. |
| `history_queue` | Initialization and profile mutation lock waiting finish. |
| `payload_import` | The iOS App Group payload import starts, succeeds, or fails. |
| `sqlite_commit` | The repository replacement call starts, succeeds, or fails. Success follows the awaited SQLite statement. |
| `history_notify` | The storage owner queues a notification or delivers it to subscribers. |
| `history_published` | A history store publication contains the file. `state` distinguishes optimistic and committed publication. |
| `history_viewable` | A focused, foreground Home collection reports the file inside its viewport. Grid geometry excludes overscan. Native layout, content-size, and throttled scroll events trigger grid observations. FlashList reports viewable data rows, excluding headers. |
| `history_frame_candidate` | A JS animation-frame callback runs after viewability. This is not a native display presentation timestamp. |
| `engine_event_js` | JS consumes an entry-related Engine event. The record includes native iOS return times when available. The record excludes event payload text. |
| `sender_report` | The outbound coordinator receives an Engine send report. |
| `sender_settled` | The coordinator stops waiting for delivery snapshots, possibly with pending or failed recipients. The counts determine the outcome. |
| `sender_ui_state` | The mobile share controller sets a job's send state to success. This is state mutation, not a rendered frame or a receiver History receipt. |

A missing terminal boundary can mean failure, deduplication, supersession, expiration, process termination, filtered logs, or incomplete capture. Inspect the stage outcomes and archive coverage. Do not infer success from the absence of an error. A cache hit can omit import and hash work.

Viewability does not detect every overlay or native animation. Grid scroll observations use the existing half-cell JS scroll threshold. A JS frame callback does not prove that the compositor displayed the row. Keep timestamped device video for pixel-level evidence.

## Investigate the next occurrence

1. Install the instrumented native build on the receiver. Use the instrumented sender build when the sender is this mobile app. Record both app builds and Engine revisions.
2. Keep the log level at `info` or `debug`. Record whether History is foreground, its layout, its filter, and auto-apply state.
3. Reproduce with a deterministic file. Record its byte count and SHA-256 in the reproduction manifest outside the diagnostic trace.
4. Record timestamped video of the sender status and receiver History. Measure the device wall-clock offset before comparing devices.
5. Export both diagnostic archives immediately after reproduction. Do not export only the receiver archive if the investigation needs sender UI timing.
6. Run the analyzer. Retain its output and both original archives.

```sh
node scripts/analyze-history-latency.mjs receiver.zip sender.zip --out /tmp/history-latency-analysis
```

The analyzer produces `timeline.jsonl` and `summary.json`. It orders records only within an archive and JS session. It lists missing boundaries. It does not guess the source identity or calculate unsynchronized cross-device latency. Join the source UUID to the Engine logs in the original archive. An older archive can produce zero latency records; that does not prove that no delay occurred.

If another application sends the file, its completion UI remains outside this change. Obtain its logs and source version separately. Source identity from a default Engine cache path is evidence from a known layout, not content hash verification.

## Repeat the controlled flow replay

```sh
npm ci --ignore-scripts
node e2e/history-latency/run.cjs e2e/results/history-latency
node scripts/analyze-history-latency.mjs e2e/results/history-latency/diagnostics.zip --out e2e/results/history-latency/analysis
```

The replay uses an 80 MiB deterministic fixture and actual file copying. It runs product JS SHA-256, history admission, SQL over SQLite, Zustand, React hooks, the diagnostic exporter, and the offline analyzer. The replay controls native clipboard access, app startup, App Group import, FlashList/native rendering, and Engine APIs. The replay exercises both platform list callbacks and the grid viewport geometry. It checks native cell layout after a same-count data replacement, viewport resizing, and empty content. It also checks copy/import/SQLite failure, duplicate identity, background/focus cancellation, logger failure, and sender report/settlement separation.

Retain `verdict.json`, `trace.jsonl`, `diagnostics.zip`, and `analysis/`. The fixture is reproducible from its byte count, repeated byte `0x5a`, and SHA-256 in the verdict. The verdict is bound to the source HEAD and the working diff hash. The replay is not a native build, two-device transfer, iOS CPU profile, or display-pixel acceptance test. Those checks remain **NOT RUN** until executed on devices.
