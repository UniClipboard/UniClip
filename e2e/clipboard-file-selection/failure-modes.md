# Failure modes recorded before implementation

## Native file application
- Plain text precedes a materialized file and wins selection.
- File precedes plain text and works only by accident of order.
- Display metadata is selected as clipboard data.
- URI data is copied instead of the referenced bytes.
- The original filename is lost during share-cache materialization.
- A file handle is ignored when text appears first.
- Missing, malformed, directory, remote, outside-root, or symlink-escaped URI is treated as a usable file.
- An unusable file candidate hides a later usable file or valid text fallback.
- Invalid handles or copy failures report success or silently expose sender paths.
- Metadata-only or unsupported file-only input exposes metadata or URI bytes as a file.
- Text-only, image, HTML, or RTF behavior changes unintentionally.
- The Android resolver requires both known format and MIME, rejecting MIME-only URI lists.

## Observation and echo
- Native writes bypass JS monitor state and schedule a changed-content callback.
- Engine content attribution fails after file URI materialization or plain-text projection.
- An event arrives before the Engine arms its next-change fallback.
- A delayed Android captured event is attributed against a newer write.
- A file write produces no readable observation, leaving the Engine fallback pending.
- The pending fallback suppresses an unrelated subsequent genuine user copy.
- Equal lengths are mistaken for equal content.
- Broad time suppression drops genuine copies, including identical content copied at a new generation.

## Coverage boundaries
The replay compiles copied production method bodies and real file resolver/share-cache code.
It uses an in-memory pasteboard and Android API doubles. It must never read the OS clipboard.
It can establish selection, copy bytes, filename, and controlled failure behavior.
It cannot establish UIKit/FileProvider integration, clipboard permissions, notification timing,
Engine/JS runtime ordering, paste-target access, or physical-device acceptance.
Device validation requires an isolated bundle/application ID, cache, Engine profile, and synthetic data.
