# Plan: `activate_clipboard` — the mobile device-clipboard proxy for sync

Status: **Design finalized — ready to implement.**

This plan is the design of record for the `activate_clipboard` feature in the RN app
(`uniclipboard-android`). It is grounded in the desktop project's **actual code** and its
authoritative docs (`sync-protocol-spec.md`, `sync-engine-design.md`, `sync-quickref.md`,
`ACTIVATE_CLIPBOARD_DESIGN.md` on the `feature/activate-clipboard-table` worktree), not in
any earlier/superseded design note.

---

## 1. Context: migrating the desktop sync core to mobile

The desktop sync core is a **pure-function reducer** (`uc-mobile-proto`, mirrored to Swift as
`SyncEngine.swift`). The RN app already runs this exact core via `uc-mobile` bindings
(`src/services/SyncEngine.ts`). Its tick loop is:

```
plan_preamble → GET /SyncClipboard.json → plan_after_server_get → route(Converged|ServerNew|Push) → commit_*
```

The reducer **never reads the clipboard**. The device's current content is **injected** as
`PreambleSnapshot.device_hash` / `ServerGetSnapshot.device_hash`. Push is gated by three
watermarks (`last_synced_hash`, `last_synced_content_id`, `last_applied_hash`) and four skips
(`SkipConsentMode` / `SkipNoDevice` / `SkipAlreadySynced` / `SkipSelfWritten`).

### The one platform gap that drives this whole design

**Desktop has a real-time clipboard watcher; mobile does not.**

- Desktop: the watcher fires on every clipboard change, so `device_hash` is **always live and
  truthful** — it reflects the actual OS clipboard at every instant.
- Mobile: iOS cannot read the pasteboard in the background (and foreground reads raise the
  "Allow Paste" prompt); Android can only monitor with READ_LOGS/accessibility. So there is
  **no live signal**. The reducer still needs a `device_hash` every tick.

That missing live signal is exactly what `activate_clipboard` supplies.

---

## 2. What `activate_clipboard` IS

> A **persistent, always-readable, single-row proxy** for "the device's current clipboard, as
> far as sync is concerned." The reducer reads it every tick (`build_preamble_snapshot()` →
> `device_hash`), even when the OS clipboard cannot be touched.

- Its **freshness is bounded by capture opportunities** (foreground, monitor, user actions).
  Between captures it may lag the real OS clipboard. That lag is inherent to mobile and
  **accepted by design** — sync operates on "the last thing we observed," not "what's on the
  clipboard this instant."
- **Why a dedicated table, not `clipboard_history` head:** `clipboard_history` is a noisy,
  multi-writer table (background history import, dedup merges, star/pin, timestamp churn).
  Feeding `device_hash` from its head would let unrelated writes disturb "what the device wants
  to sync." `activate_clipboard` is a **single-intent, low-noise sync register** insulated from
  that churn. This isolation is its core value.

---

## 3. The hazard the real-time gap creates — and the resolution

Because the proxy does not auto-update (no watcher), a naive rule "passive apply must not write
activate" opens a **stale re-push** hole. Concrete trace:

```
init:   activate=X (user copied X, pushed), last_synced=X, OS clipboard=X
① another device pushes Y to the server
② tick: device_hash=X (from activate); GET server=Y
        plan_after_server_get: server≠device → ServerNew → apply Y to OS clipboard
        commit_apply: last_synced=Y, last_applied=Y
        (rule "apply doesn't write activate") ⇒ activate still = X;  OS clipboard = Y
③ tick: device_hash STILL = X (activate never updated); GET server=Y
        server(Y)≠device(X) but is_already_synced(Y)=true (last_synced=Y) → route = Push
        plan_push: X≠last_synced(Y), X≠last_applied(Y) → DoPush X
        ✗ re-pushes stale X, overwrites the other device's Y, ping-pongs
```

**Root cause:** desktop's watcher refreshes device content to Y right after apply, so the proxy
never lies. On mobile nothing refreshes it, so it holds stale X and the reducer mistakes it for
new local content.

**Resolution — put the active/passive distinction in the PUSH gate, not the WRITE gate.** The
reducer's watermarks already prevent pushing applied content. We must NOT try to express
"passive" by withholding the activate write (that's what opens the hole). Instead:

> **On apply, CLEAR the `activate_clipboard` row.**

This honors the semantic literally (applied content is *not* recorded as an activation) **and**
removes the stale-X trap (nothing to re-push; `device_present=false` until the next genuine
capture; the OS clipboard's real content Y already matches `last_synced=Y`).

### The three write rules (all through one entry point)

| Trigger | activate write |
| --- | --- |
| Genuine local new content (foreground snapshot / Android monitor), `≠ last_applied_hash` and `≠ current activate` | **write** (local activation; `content_id` null) |
| User actively uses / restores an item | **write** (carry that item's `content_id` if it has one) |
| Passive apply of remote content | **clear the row** (not an activation; watermarks already prevent re-push) |

---

## 4. Data model

### `activate_clipboard` (new table, snake_case per authoritative docs)

```sql
CREATE TABLE activate_clipboard (
  id              INTEGER PRIMARY KEY CHECK (id = 1),  -- single-row register
  profile_hash    TEXT NOT NULL,                        -- pointer → clipboard_history.profileHash
  content_id      TEXT,                                 -- server identity for the current row (denormalized)
  activated_at_ms INTEGER NOT NULL                      -- moment this became the current activation
);
```

- `profile_hash` points at a **guaranteed-present** `clipboard_history` row (if absent at write
  time, insert the history row first). This is what makes the pointer safe.
- "Cleared" = delete the row (id=1 absent) → `device_present=false`.

### `clipboard_history` gets a `contentId` column (decided)

Add `contentId TEXT` (camelCase, matching this table's existing convention). Pulled/applied
items store their server identity (`blake3v1:<hex>`); locally-copied items are null. This makes
**every history item retain its server identity**, so:

- `activate` resolves `content_id` via its `profile_hash` pointer (authoritative source lives on
  history, `activate.content_id` is just a denormalized copy of the current row);
- "user re-activates an old server-pulled item" recovers that item's `content_id` naturally — no
  fragile "read from the watermark."

> Naming note: `activate_clipboard` uses snake_case (per the authoritative doc); `clipboard_history`
> stays camelCase (`contentId`, matching `profileHash`/`localClipboardHash`). Each table stays
> internally consistent; the RN row-mapper handles activate's column names separately.

---

## 5. Write path

Unified entry (`writeActivate`) — every trigger funnels here:

```
writeActivate(content):
  profile_hash = computeProfileHash(content)
  if profile_hash == last_applied_hash: return        # passive echo — not an activation
  if profile_hash == current_activate?.profile_hash: return   # unchanged — no-op
  row = history.getByProfileHash(profile_hash)
  if row == null: row = history.insert(createDefaultItem(content))   # guarantee pointer target
  activate.upsert(id=1, profile_hash, content_id, activated_at_ms=now)

applyRemote(entry):        # the reducer/apply path
  ... write OS clipboard, commit_apply (watermarks advance) ...
  activate.clear()         # §3: drop the row; do NOT record applied content as an activation
```

- **Anti-echo** reuses `SyncEngine.lastAppliedContentHash` (`src/services/SyncEngine.ts:152`,
  set by `noteDeviceWrite` `:492-495`). Currently private → expose a getter or route the check
  through `syncEngineStore`.
- **`content_id` at write time:** local copy → null; using an item that carries a cid → that cid
  (from the history row's new `contentId`).

### Per-platform capture triggers (the gap, concretely)

- **iOS** — `AppState` foreground → `changeCount` gating (read content only when it advanced, to
  avoid paste-prompt spam) → anti-echo guard → `writeActivate`. Plus in-app user actions. **No
  background capture.** Product consequence to accept: *iOS uploads sync when you next open the
  app.* Reuse the embryonic foreground read at `ClipboardMonitor.ts:512-534`.
- **Android** — keep the live monitor (READ_LOGS/accessibility → near-real-time) **and**
  foreground snapshot + user actions; all call the same `writeActivate`.
- **iOS extensions** (share/keyboard, run while main app is suspended) — write activate **and**
  keep their own immediate push (a share must sync now), coordinating via App Group watermarks
  (`persisted_synced_*`, folded back in `plan_preamble`) so the main app does not double-push.

---

## 6. Consumption

### Sync core (device_hash) — the whole point

Repoint `getDeviceClipboard()` (`src/stores/syncEngineStore.ts:67-85`) to **read the
`activate_clipboard` row**, resolve content from `clipboard_history` via `profile_hash`, and feed
`PreambleSnapshot.device_hash` / `ServerGetSnapshot.device_hash`. Retire the in-memory
`lastDeviceContent`. Push gating (autoPush / watermarks) is **unchanged**.

### Display "current item" — use `clipboard_history` head, NOT activate

`clipboard_history` head (most recent by timestamp) always reflects the true current clipboard
(local or applied), reads without a paste prompt, and is always populated — whereas `activate`
is cleared after apply. So Swift extensions / RN UI showing "current item" read **history head**.
`activate` is **purely the sync device_hash proxy**, nothing else.

---

## 7. Swift side (iOS extensions)

The keyboard/share extensions open the shared App Group `uniclipboard.db` via the raw SQLite3 C
API, `SQLITE_OPEN_READWRITE` (never create), WAL + `busy_timeout=3000`
(`targets/_shared/HistoryDatabase.swift`).

- Extensions **do not need to read `activate_clipboard`** for display (display uses history head,
  §6). They only need the new `clipboard_history.contentId` column when reading history rows.
- If any Swift path writes activate (e.g. share captures new content), add a small
  `ActiveClipboardDatabase.swift` writer; **fault-tolerant** (prepare/step failure → no-op, in
  case RN hasn't created the table yet — Swift never creates it).
- ⚠️ **Double-copy discipline:** `targets/_shared/*.swift` and
  `modules/app-group-store/ios/Shared/*.swift` are byte-identical copies. Any Swift change
  (new writer, `ClipboardModels.swift` `contentId` field) must be made in **both**.

---

## 8. Schema migration

`src/services/db/database.ts`: bump `SCHEMA_VERSION` `1 → 2`, add `migrateToV2`:

```
if (currentVersion < 2) await migrateToV2(db)
migrateToV2:
  CREATE TABLE IF NOT EXISTS activate_clipboard (... §4 ...);
  ALTER TABLE clipboard_history ADD COLUMN contentId TEXT;   -- pulled items back-carry identity
  PRAGMA user_version = 2;
```

No backfill for activate (lazy on first activation). `clipboard_history.contentId` defaults null;
future pulls populate it. Update `rowMapper.HISTORY_COLUMNS` for the new column.

---

## 9. What stays UNCHANGED (the migration's payoff)

The `uc-mobile` reducer is **not modified at all**. We only (a) create/maintain the activate
table, (b) feed its value into the snapshots, (c) clear it on apply. That is the entire point of
porting desktop's pure-function core: the decision logic is shared and untouched; only the
mobile-specific "how do we obtain device content" shell differs.

---

## 10. Implementation phasing

1. **Schema:** `migrateToV2` (activate table + `clipboard_history.contentId`) + `activateRepository`
   (get / upsert / clear single row) + rowMapper update.
2. **Write path:** `writeActivate` (anti-echo → de-dup → ensure-history-row → upsert) and
   `activate.clear()` on apply; wire clipboard callback + iOS/Android foreground snapshot + user
   actions into it. Populate `clipboard_history.contentId` on pull/apply.
3. **Consumption:** repoint `getDeviceClipboard()` to the activate table; retire `lastDeviceContent`.
   Point "current item" display at history head.
4. **Swift:** add `contentId` to the history row model (both copies); optional activate writer if a
   Swift path activates.
5. **Verify:** local copy → activate updates → (autoPush on) pushes once, idempotent; receive
   remote → apply → activate cleared → **no** stale re-push; use a server-pulled item → activates
   with its `content_id` → re-points server; iOS backgrounded copy → syncs on next foreground.

---

## 11. Corrections carried over (code beats stale docs)

An earlier draft of this plan was misled by a superseded design note. Corrected to match actual
desktop **code**:

- Desktop's active state is **persisted** (single-row `active_clipboard_register`, actively
  read/written), not in-memory, and that table is **not** dead code. (Mobile persists too, for
  different reasons: cross-process extensions + volatile processes + snapshot-driven capture.)
- Restart recovery on desktop is **reconcile-vs-real-OS-clipboard, else clear** — not
  "rebuild from history." (Removed the earlier rebuild-from-history fallback.)
- Desktop's watcher is **event-driven**, not fixed-interval polling.
