# History latency diagnostic failure modes

Write these cases before the implementation and the controlled flow replay.

- A source file has no Engine cache entry ID. Record an unmatched identity; never guess from time or size.
- Two files arrive together or have identical names or sizes. Keep separate read IDs and bind by the computed full SHA-256 in memory.
- A duplicate file reuses a history row. Keep the new read ID; do not treat an old visible row as the new admission.
- Copy, hash, lookup, import, or SQLite fails. Record the failed stage and preserve the original exception.
- The logger fails. Diagnostics must not fail the clipboard or history operation.
- The logger writes later or the wall clock changes. Capture occurrence timestamps and monotonic stage durations before logging.
- A debounce replaces a pending file or a monitor generation discards it. Record that outcome rather than implying admission.
- A list measures an offscreen row or a grid mounts an overscan cell. Do not report either as visible.
- The app is in the background or Home loses focus. Do not report a visible frame candidate.
- A JS frame callback runs. Label it as a candidate, never as proof that pixels reached the display.
- Entry metadata includes paths, filenames, file bytes, full hashes, peers, or preview text. Do not export those fields in latency records.
- A process restarts or the bounded context expires. Report the missing link; do not invent continuity.
- Sender and receiver clocks differ. Do not subtract their wall clocks without measuring clock offset.
- The sender uses an older or different application. State that sender UI evidence remains unavailable.
- Logs rotate, are filtered, or are truncated. Keep the archive's existing capture and collection warnings.

The replay uses actual product TypeScript with controlled native file, clock, storage, and rendering boundaries. It is not a device performance or pixel-display acceptance test. Retain a JSON verdict and structured trace. Native two-device verification must retain both archives and timestamped video.

## Event-driven grid visibility regression

- A layout or scroll event must report the viewport without an effect that calls a parent prop.
- A new keyed cell can enter the viewport while the item count and scroll position stay unchanged. Its native layout event must report the new item.
- An overscan cell can mount outside the viewport. Its layout event must not classify that cell as visible.
- A viewport can have zero height before native layout. Do not report a visible file before layout.
- Content size and viewport size can change. Use native layout events and the last observed scroll position.
