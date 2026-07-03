# PRD — SyncClipboard Protocol: `originHash` Field

Status: Proposed
Owner: Server (uniclipboard daemon)
Consumers: Mobile sync clients (iOS / Android)
Scope: Server-side only. This document defines **requirements and the protocol
contract**. It does not prescribe an implementation.

---

## 1. Background

The daemon normalizes clipboard images during ingest: any image whose MIME type
is not `image/png` or `image/webp` (e.g. `image/jpeg`, `image/gif`,
`image/tiff`) is decoded and re-encoded to PNG before it becomes the canonical
clipboard payload. This re-encode changes the payload bytes.

Mobile clients identify clipboard content by the SHA-256 of its bytes. The client
computes a hash from the bytes it uploads; the server later serves a different
(re-encoded) payload with a different hash. The client cannot predict the
re-encoded bytes, so the two hashes never match.

### Observed failure (measured)

1. Client shares a JPEG screenshot. Local content hash `A = 804B8329…C121B0F`
   (SHA-256 of the JPEG bytes).
2. Client uploads it (`POST /api/history` + `PUT /SyncClipboard.json`,
   `dataName` ending in `.jpg`).
3. Server re-encodes JPEG → PNG. Next `GET /SyncClipboard.json` returns
   `dataName = clipboard_<id>.png` with hash `B = 716318AC…AEF539B`
   (SHA-256 of the PNG bytes). `A ≠ B`.
4. The client treats `B` as new remote content and creates a **second** card for
   the same image it just shared.

Text and non-image files are unaffected (no re-encode → upload hash == served
hash).

---

## 2. Problem statement

After a re-encode, the client has no protocol-level way to learn that the
server's canonical entry (hash `B`) is the same logical content it just uploaded
(hash `A`). It therefore cannot collapse the two into a single item.

---

## 3. Goals

- G1. Expose, per clipboard entry, the hash of the **original uploaded bytes** so
  a client can recognize a server entry as the canonicalized form of its own
  upload, even when the server re-encoded the payload.
- G2. Be backward compatible: existing clients and servers continue to work
  unchanged.
- G3. Keep the existing canonical content hash (`hash`) semantics intact.

## 4. Non-goals

- Changing the canonical hash algorithm, the `dataName` scheme, or the re-encode
  policy.
- Adding protocol version negotiation.
- Changing the History API record shape (see §8).
- Any client-side behavior (defined separately by the client team).

---

## 5. Protocol change

A new optional field, `originHash`, is added to the clipboard profile document
exchanged at `GET/PUT /SyncClipboard.json`.

| Property    | Value                                                             |
| ----------- | ----------------------------------------------------------------- |
| JSON key    | `originHash`                                                      |
| Type        | string (SHA-256, uppercase hex, 64 chars) — same format as `hash` |
| Optionality | Optional. Omitted when not applicable (see §6).                   |
| Position    | Adjacent to `hash` in serialization order.                        |

The existing `hash` field (the canonical content hash) is unchanged.

---

## 6. Semantics & requirements

### 6.1 Definitions

- **Canonical hash (`hash`)**: SHA-256 (uppercase hex) of the payload bytes the
  server currently serves for this entry via `GET /file/{dataName}`.
- **Origin hash (`originHash`)**: SHA-256 (uppercase hex) of the exact payload
  bytes that were originally uploaded to create this entry, **before any
  server-side normalization or re-encoding**.

### 6.2 Core invariant

- R1. For any clipboard entry created from a mobile upload, the value reported in
  `originHash` MUST equal the SHA-256 of the exact bytes the client uploaded for
  that entry, and MUST remain stable for the lifetime of the entry — **even after
  the server re-encodes the payload** (i.e. even after `hash` changes from the
  original value to the re-encoded value).

In other words: `hash` may change `A → B` when a re-encode occurs; `originHash`
MUST stay `A`.

### 6.3 GET `/SyncClipboard.json`

- R2. When the current clipboard entry originated from a mobile upload that was
  re-encoded (origin bytes ≠ served bytes, i.e. `originHash ≠ hash`), the
  response MUST include `originHash` set to the origin hash.
- R3. When origin bytes == served bytes (`originHash` would equal `hash`), the
  server MAY omit `originHash`. Clients MUST treat an absent `originHash` as
  "equal to `hash`".
- R4. The response MUST remain internally consistent at every point in time:
  `hash` always reflects the currently-served bytes, and `originHash` always
  reflects the original uploaded bytes for the same entry. Specifically, across
  the asynchronous re-encode there are exactly two valid observable states for an
  uploaded image:
  - Before re-encode: served bytes are still the original → `hash = A`, and
    `originHash` is absent or `A`.
  - After re-encode: served bytes are PNG → `hash = B`, `originHash = A`.
    There MUST be no state in which `hash = B` while `originHash` is absent or ≠ A.

### 6.4 PUT `/SyncClipboard.json`

- R5. No client behavior change is required on upload. The client continues to
  send `hash` (the hash of the bytes it is uploading). The server MUST NOT
  require the client to send `originHash`; if a client does send it, the server
  MAY ignore it.
- R6. The server is the authority for `originHash`: it derives the origin hash
  from the actual uploaded bytes, not from any client-declared value.

### 6.5 Content types

- R7. For Text and non-image File content (no re-encode), `originHash == hash`;
  per R3 the server MAY omit it.
- R8. For images that are not re-encoded (`image/png`, `image/webp`),
  `originHash == hash`; per R3 the server MAY omit it.
- R9. For re-encoded images (e.g. `image/jpeg`, `image/gif`, `image/tiff`),
  `originHash` MUST be present and ≠ `hash` (R2).

---

## 7. Backward compatibility

- C1. `originHash` is an optional additive field. Servers that do not send it and
  clients that do not read it behave exactly as today.
- C2. Serialization MUST omit `originHash` entirely when not applicable (no
  `null` value emitted), consistent with the existing optional-field convention.
- C3. Deserialization of documents lacking `originHash` MUST succeed with the
  field treated as absent.
- C4. No protocol version bump is required.

---

## 8. History API (`/api/history`)

- H1. No History API shape change is required by this PRD.
- H2. However, the duplicate-prevention guarantee only holds if a re-encoded
  image cannot re-enter a client as a _new_ history record under its origin hash
  `A` after the client has already converged on canonical hash `B`. The server
  MUST ensure that history queries do not surface the same logical content under
  two different hashes (`A` from the original upload and `B` after re-encode) such
  that a client would create a second item.
  - This is a behavioral requirement, not a shape requirement. How it is met
    (e.g. the history record reflecting the canonical hash, or otherwise) is left
    to the implementation.

---

## 9. Acceptance criteria

Using the measured repro (JPEG screenshot, origin `A`, canonical PNG `B`):

- AC1. **Re-encoded image exposes origin.** Given a client uploads a JPEG with
  bytes hashing to `A`; when the server has re-encoded it to PNG with bytes
  hashing to `B`; then `GET /SyncClipboard.json` returns `hash = B` and
  `originHash = A`, with `A ≠ B`.

- AC2. **Pre-encode consistency.** At any moment before the re-encode completes,
  `GET /SyncClipboard.json` returns `hash = A` and `originHash` absent or `A`
  (never `hash = B` without `originHash = A`).

- AC3. **Origin stability.** Repeated `GET /SyncClipboard.json` for the same
  entry after re-encode always returns the same `originHash = A` and the same
  `hash = B` (deterministic, stable across polls).

- AC4. **Passthrough formats omit origin.** Given a client uploads a PNG (or
  WebP) with bytes hashing to `H`; then `GET /SyncClipboard.json` returns
  `hash = H` and `originHash` absent (or equal to `H`).

- AC5. **Text/File unaffected.** Given Text or a non-image File upload; then
  `originHash` is absent (or equal to `hash`).

- AC6. **Backward compatibility.** A profile document without `originHash`
  deserializes successfully (field absent); a profile with `originHash == hash`
  is permitted; no `null` is ever serialized for `originHash`.

- AC7. **No history re-introduction.** After a client has converged on canonical
  hash `B` for a shared re-encoded image, history queries do not cause the client
  to receive the same content again under origin hash `A` (§8 / H2).

---

## 10. Open questions (for the server implementer)

- Q1. Durability of the origin↔canonical association across daemon restarts:
  is it acceptable for `originHash` to become unavailable (absent) for entries
  created before a restart, given the reconcile window is normally seconds after
  upload? (If not, the association must survive restarts.)
- Q2. Retention/eviction policy for the origin↔canonical association (how many
  past entries must continue to report `originHash`).
- Q3. Confirmation of the exact re-encode trigger set
  (`should_convert_to_png`: all `image/*` except `image/png` and `image/webp`)
  so AC4/AC9 cover the correct passthrough list.
