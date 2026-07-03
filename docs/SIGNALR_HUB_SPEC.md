# SyncClipboard SignalR Hub — Server Implementation Spec

Status: **Required, currently missing on server.** The mobile/desktop clients
connect to `{serverUrl}/SyncClipboardHub` for real-time push. When the hub is
absent the SignalR negotiate step returns **404 Not Found**, the client retries
forever, and **automatic clipboard sync silently fails** (HTTP polling / pull
still works, which is why manual "pull to refresh" succeeds but the foreground
auto-sync does not).

This document is the complete contract the client expects, reverse-engineered
from the client code, so a server engineer can implement the hub without reading
the app source. Field names, casing, transports, auth and trigger semantics are
all normative.

---

## 1. Scope

The hub is **push-only, server → client**. The client **only subscribes**; it
never invokes any hub method on the server (verified: no `.invoke(...)` /
`.send(...)` calls exist in the client). Therefore the server needs to:

1. Expose the hub endpoint with a working `negotiate`.
2. Authenticate the connection (HTTP Basic, same credentials as the REST API).
3. Broadcast two client methods when server-side state changes:
   - `RemoteProfileChanged` — the "current clipboard" changed.
   - `RemoteHistoryChanged` — a history record was created/updated/deleted.

No server-callable hub methods are needed.

---

## 2. Connection

| Property     | Value                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hub URL      | `{serverUrl}/SyncClipboardHub` (e.g. `http://192.168.1.217:42720/SyncClipboardHub`)                                                               |
| Framework    | ASP.NET Core SignalR (clients use `@microsoft/signalr` JS lib and `com.microsoft.signalr` Java lib)                                               |
| Hub protocol | Default **JSON** hub protocol                                                                                                                     |
| Negotiate    | **Required.** `skipNegotiation = false` on all clients → server must serve `POST {hub}/negotiate`. This is the endpoint returning 404 today.      |
| Transport    | **WebSockets.** The Android client forces `TransportEnum.WEBSOCKETS`. The negotiate response must advertise WebSockets as an available transport. |
| Auth         | HTTP **Basic** — header `Authorization: Basic base64(username:password)`, identical credentials to the REST API.                                  |
| Keep-alive   | Standard SignalR ping/pong; defaults are fine.                                                                                                    |

### Auth details

The client sends `Authorization: Basic ...` on the negotiate request. The server
must:

- Validate Basic credentials on `POST {hub}/negotiate` (reject with 401 if
  invalid — do **not** 404).
- Allow the subsequent WebSocket upgrade for the authenticated connection.
  (Browsers cannot set custom headers on the WebSocket handshake; the standard
  SignalR flow authenticates at negotiate and carries the connection via the
  negotiate-issued `connectionToken`. If you additionally gate the WebSocket
  endpoint, also accept the SignalR `access_token` query param.)

With ASP.NET Core, `app.MapHub<SyncClipboardHub>("/SyncClipboardHub")` provides
the negotiate + WebSocket endpoints automatically; the 404 means the hub is not
mapped at all.

---

## 3. Client methods to broadcast

These are **client method names** — the server invokes them on connected
clients, e.g. `Clients.All.SendAsync("RemoteProfileChanged", profile)`.

### 3.1 `RemoteProfileChanged(profile)`

Sent whenever the "current clipboard" (`/SyncClipboard.json`) changes. Single
argument `profile`, an object identical to the REST `/SyncClipboard.json` body.

| Field      | JSON type | Required            | Meaning                                                                                     |
| ---------- | --------- | ------------------- | ------------------------------------------------------------------------------------------- |
| `type`     | string    | **yes**             | One of `"Text"`, `"Image"`, `"File"`, `"Group"`.                                            |
| `hash`     | string    | **yes**             | Profile SHA-256, **UPPERCASE hex** (see §6). Empty string `""` for `Group`.                 |
| `text`     | string    | **yes**             | For short `Text`: the full text. For `Image`/`File`/`Group` or large text: a preview/label. |
| `hasData`  | bool      | **yes**             | `true` if there is an associated binary file fetched via `/file/{dataName}`.                |
| `dataName` | string    | when `hasData=true` | File name of the associated data.                                                           |
| `size`     | number    | optional            | Size in bytes of the associated data.                                                       |

Example payload (note the casing — see §4):

```json
{
  "type": "Text",
  "hash": "9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08",
  "text": "hello world",
  "hasData": false
}
```

Per-type field semantics (how the client fills these on upload — mirror them):

- **Text, short**: `hasData=false`, `text` = full text, `size` omitted (client
  falls back to `text.length`).
- **Text, large**: stored as a `.txt` file → `hasData=true`, `dataName` set,
  `text` = preview, `size` = file bytes.
- **Image**: `hasData=true`, `text` = `"[图片]"` placeholder if none, `dataName`
  - `size` set.
- **File**: `hasData=true`, `text` = file name or `"[文件]"`, `dataName` +
  `size` set.
- **Group** (multiple files): `hasData=true`, `text` = `"[文件组]"`, `hash` = `""`.

### 3.2 `RemoteHistoryChanged(record)`

Sent whenever a history record is created, updated (star/pin/version), or
soft-deleted. Single argument `record`.

| Field          | JSON type         | Required    | Meaning                                                    |
| -------------- | ----------------- | ----------- | ---------------------------------------------------------- |
| `hash`         | string            | **yes**     | Record SHA-256 (uppercase hex).                            |
| `type`         | string            | **yes**     | `"Text"`, `"Image"`, or `"File"` (history has no `Group`). |
| `text`         | string            | recommended | Preview/text.                                              |
| `hasData`      | bool              | recommended | Whether binary data exists.                                |
| `size`         | number            | recommended | Bytes.                                                     |
| `starred`      | bool              | recommended | Star flag.                                                 |
| `pinned`       | bool              | recommended | Pin flag.                                                  |
| `version`      | number (int)      | recommended | Optimistic-concurrency version.                            |
| `isDeleted`    | bool              | recommended | `true` for soft delete.                                    |
| `createTime`   | string (ISO 8601) | optional    | e.g. `"2026-06-14T08:30:00.000Z"`.                         |
| `lastModified` | string (ISO 8601) | optional    |                                                            |
| `lastAccessed` | string (ISO 8601) | optional    |                                                            |

> The client applies safe defaults for missing fields, but send all of them when
> available to keep the local history list consistent without an extra REST
> round-trip.

---

## 4. Field casing — read this carefully

This is the most common implementation mistake.

- REST `/SyncClipboard.json` uses **camelCase** (`type`, `hash`, `text`,
  `hasData`, `dataName`, `size`).
- The **Android** SignalR client reads **PascalCase first, then falls back to
  camelCase** — so it accepts either.
- The **JS / iOS** SignalR client reads **camelCase only** (`profile.type`,
  `profile.hash`, …). PascalCase → `undefined`.

**Therefore the server MUST serialize push payloads in camelCase.** camelCase
satisfies all clients (Android via fallback, JS/iOS directly) and matches the
existing REST contract.

ASP.NET Core SignalR defaults to **PascalCase** (System.Text.Json does not
camel-case by default for SignalR). You must opt in explicitly:

```csharp
builder.Services
    .AddSignalR()
    .AddJsonProtocol(options =>
    {
        options.PayloadSerializerOptions.PropertyNamingPolicy =
            System.Text.Json.JsonNamingPolicy.CamelCase;
    });
```

If you only ever support the Android client you could leave it PascalCase, but
camelCase is the correct, future-proof choice.

---

## 5. When to broadcast (trigger semantics)

| Server event                                                           | Broadcast                                                                         |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `PUT /SyncClipboard.json` succeeds (current clipboard updated)         | `RemoteProfileChanged` with the new profile                                       |
| `POST /api/history` (record created)                                   | `RemoteHistoryChanged` with the record                                            |
| `PUT /api/history/{type}/{profileId}` (star/pin/delete/version update) | `RemoteHistoryChanged` with the updated record (use `isDeleted=true` for deletes) |

Recipients: broadcast to **all connected clients**. It is safe to include the
originator — the client de-duplicates against its own last-uploaded hash
(`isJustUploaded` check), so an echo will not cause a clipboard loop. If you can
cheaply identify the originating connection you may exclude it
(`Clients.AllExcept(...)`), but this is an optimization, not a requirement.

Ordering: send `RemoteProfileChanged` after the new profile is durably stored, so
a client that reacts by `GET /SyncClipboard.json` sees the new value.

---

## 6. Hash rules (must match for de-duplication)

The client keys de-duplication and history identity on `hash`. The server must
produce/accept the same values. All hashes are **SHA-256, UPPERCASE hex**.

- **Text**: `hash = SHA256(text)`.
- **Image / File**: `hash = SHA256(fileName + "|" + SHA256(fileBytes))`, where
  the inner `SHA256(fileBytes)` is uppercase hex before concatenation.
- **Group**: `hash = ""`.

History identity `profileId = "{type}-{hash}"` (e.g. `Text-9F86...`). The REST
history endpoints already use this; the hub does not need it, but the `hash` you
push must equal the one stored.

---

## 7. Related REST endpoints (context / push sources)

These already exist on your server (HTTP works); listed so you can wire the
broadcasts at the right place.

| Method    | Path                              | Purpose                                                                                        |
| --------- | --------------------------------- | ---------------------------------------------------------------------------------------------- |
| GET / PUT | `/SyncClipboard.json`             | Current clipboard profile (ProfileDto). PUT is the trigger for `RemoteProfileChanged`.         |
| PUT       | `/file/{fileName}`                | Upload binary data (octet-stream) for `hasData` profiles.                                      |
| POST      | `/api/history`                    | Create history record (multipart: record + optional file). Trigger for `RemoteHistoryChanged`. |
| GET       | `/api/history/query`              | List/query records.                                                                            |
| GET       | `/api/history/{profileId}`        | Fetch one record.                                                                              |
| PUT       | `/api/history/{type}/{profileId}` | Update star/pin/delete/version. Trigger for `RemoteHistoryChanged`.                            |
| GET       | `/api/history/{profileId}/data`   | Download record's binary data.                                                                 |
| GET       | `/api/history/statistics`         | Aggregate counts.                                                                              |

---

## 8. Client reconnect behavior (FYI for load/stability)

- **Android** (`com.microsoft.signalr`): on failure, reconnects with backoff
  (~2s, then up to 60s), effectively indefinitely. Expect persistent reconnect
  attempts from clients pointed at a server without the hub until it ships.
- **JS** (`@microsoft/signalr`): `withAutomaticReconnect`, exponential backoff,
  up to 5 attempts.

A correctly mapped hub with a stable negotiate removes the reconnect storm.

---

## 9. Reference skeleton (ASP.NET Core, illustrative)

```csharp
// Hub: no server-callable methods needed — push only.
public class SyncClipboardHub : Hub { }

// Startup / Program.cs
builder.Services.AddSignalR()
    .AddJsonProtocol(o =>
        o.PayloadSerializerOptions.PropertyNamingPolicy =
            System.Text.Json.JsonNamingPolicy.CamelCase);

app.MapHub<SyncClipboardHub>("/SyncClipboardHub");
    // apply the same Basic-auth requirement as the REST API

// Where the current clipboard is updated (PUT /SyncClipboard.json):
await _hub.Clients.All.SendAsync("RemoteProfileChanged", profile);

// Where a history record is created/updated/deleted:
await _hub.Clients.All.SendAsync("RemoteHistoryChanged", record);
```

`profile` / `record` are plain objects whose JSON shapes match §3 (camelCase).

---

## 10. Acceptance criteria

1. `POST {serverUrl}/SyncClipboardHub/negotiate?negotiateVersion=1` with valid
   Basic auth returns **200** with a JSON body containing `connectionId` and
   `availableTransports` including `WebSockets` — **not 404, not 401**.

   ```
   curl -u USER:PASS -X POST \
     "http://192.168.1.217:42720/SyncClipboardHub/negotiate?negotiateVersion=1"
   ```

2. After pointing the app at the server, the client log shows
   `SignalR connected successfully` (Android tag `SignalRClientModule`).

3. On device A, copy new text (or `PUT /SyncClipboard.json`). On device B (app in
   foreground, idle), the log shows `RemoteProfileChanged received` and the new
   text is written to the system clipboard automatically.

4. Payload keys are camelCase; the JS/web client also receives a populated
   `profile.text` (not `undefined`).

When all four pass, the foreground auto-sync issue is resolved end-to-end.
