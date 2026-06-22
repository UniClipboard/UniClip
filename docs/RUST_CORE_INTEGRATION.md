# Rust Core Integration Design

Integration plan for `uc-mobile` (UniFFI Rust core) into the Expo React Native project.

## Architecture

```
TypeScript (React Native)
    ↓
modules/uc-core/src/index.ts              ← Expo Module TS wrapper
    ↓
Expo Module API (Swift / Kotlin)
    ↓
UniFFI-generated Swift / Kotlin bindings   ← auto-generated from Rust
    ↓
libuc_mobile.a (iOS) / libuc_mobile.so (Android)  ← Rust static/dynamic lib
```

## Directory Structure

```
uniclipboard-android/
├── modules/
│   └── uc-core/                           ← NEW Expo local module
│       ├── expo-module.config.json
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   └── index.ts                   ← TS API for RN code
│       ├── ios/
│       │   ├── UcCoreModule.swift                   ← Expo Module definition
│       │   ├── UniClipboardCore.xcframework/        ← Rust static lib (fat binary, gitignored)
│       │   └── Bindings/
│       │       ├── uc_mobile.swift                  ← UniFFI generated Swift bindings
│       │       └── include/                         ← C header + modulemap
│       └── android/
│           ├── build.gradle
│           ├── src/main/
│           │   ├── AndroidManifest.xml
│           │   ├── java/expo/modules/uccore/
│           │   │   ├── UcCoreModule.kt              ← Expo Module definition
│           │   │   └── uniffi/uc_mobile/            ← UniFFI generated Kotlin bindings
│           │   │       └── uc_mobile.kt
│           │   └── jniLibs/                         ← .so per ABI (committed)
│           │       ├── arm64-v8a/libuc_mobile.so
│           │       ├── armeabi-v7a/libuc_mobile.so
│           │       └── x86_64/libuc_mobile.so
│           └── libs/
│
├── rust-core/                             ← Rust source + build scripts
│   ├── Cargo.toml                         ← workspace root
│   ├── crates/
│   │   ├── uc-mobile/                     ← UniFFI boundary crate (FFI surface)
│   │   │   ├── Cargo.toml
│   │   │   ├── src/
│   │   │   │   ├── lib.rs                 ← ConnectPayload, parse_connect_uri
│   │   │   │   ├── client.rs              ← MobileSyncClient, async HTTP ops
│   │   │   │   ├── reducer.rs             ← Sync engine decision reducer
│   │   │   │   └── bin/uniffi-bindgen.rs  ← Bindgen CLI entrypoint
│   │   │   └── scripts/
│   │   │       ├── build-ios-xcframework.sh
│   │   │       └── build-android.sh
│   │   └── uc-mobile-proto/               ← Pure codec leaf crate (no FFI deps)
│   │       ├── Cargo.toml
│   │       └── src/
│   │           ├── lib.rs
│   │           ├── connect_uri.rs
│   │           ├── clipboard_doc.rs
│   │           ├── history_record.rs
│   │           ├── multipart.rs
│   │           ├── sync_engine.rs
│   │           └── ...
│   └── scripts/
│       ├── build-ios.sh                   ← Build xcframework + copy to modules/uc-core/ios
│       ├── build-android.sh               ← Build .so + copy to modules/uc-core/android
│       └── update-bindings.sh             ← One-command: build both + generate bindings
│
└── plugins/
    └── build/
        └── withRustCore.js                ← Config plugin for xcframework linking
```

### Rust source management

The Rust crates (`uc-mobile` + `uc-mobile-proto`) live inside this repo under `rust-core/crates/`.
They are extracted from the upstream `uniclipboard` monorepo and maintained here as the
single source of truth for the mobile FFI surface.

`rust-core/Cargo.toml` is a standalone workspace (NOT part of the upstream monorepo workspace):

```toml
[workspace]
members = [
  "crates/uc-mobile",
  "crates/uc-mobile-proto",
]

[workspace.package]
version = "0.1.0"
license = "MIT"
```

The `uc-mobile-proto` crate is a pure leaf (zero workspace deps beyond small codec crates
like serde, base64, sha2), so it copies cleanly. `uc-mobile` depends only on `uc-mobile-proto`
plus vendored external crates (uniffi, reqwest, tokio, etc.).

## Phase 1: iOS Integration (Priority)

### 1.1 Build Pipeline (`rust-core/scripts/build-ios.sh`)

Builds the xcframework from `rust-core/` source and stages output into the Expo module:

```bash
#!/usr/bin/env bash
# Build iOS xcframework + UniFFI Swift bindings from local rust-core/ source,
# then stage artifacts into modules/uc-core/ios/.
#
# Prerequisites:
#   - Xcode with iOS SDK
#   - Rust targets: rustup target add \
#       aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUST_ROOT="$REPO_ROOT/rust-core"
MODULE_DIR="$REPO_ROOT/modules/uc-core/ios"

BINDINGS_DIR="$RUST_ROOT/target/uniffi-bindings"
XCFRAMEWORK_OUT="$RUST_ROOT/target/UniClipboardCore.xcframework"

# 1. Host cdylib + Swift bindings (uniffi-bindgen library mode)
echo "==> [1/5] Host cdylib + Swift bindings"
(cd "$RUST_ROOT" && cargo build -p uc-mobile)
rm -rf "$BINDINGS_DIR"
(cd "$RUST_ROOT" && cargo run -p uc-mobile --features bindgen-cli --bin uniffi-bindgen -- \
  generate --library target/debug/libuc_mobile.dylib \
  --language swift --out-dir "$BINDINGS_DIR")

mkdir -p "$BINDINGS_DIR/include"
cp "$BINDINGS_DIR/uc_mobileFFI.h" "$BINDINGS_DIR/include/"
cp "$BINDINGS_DIR/uc_mobileFFI.modulemap" "$BINDINGS_DIR/include/module.modulemap"

# 2. Device static lib
echo "==> [2/5] Device static lib (aarch64-apple-ios, release)"
(cd "$RUST_ROOT" && cargo build -p uc-mobile --release --target aarch64-apple-ios)

# 3. Simulator static libs
echo "==> [3/5] Simulator static lib (aarch64-apple-ios-sim, release)"
(cd "$RUST_ROOT" && cargo build -p uc-mobile --release --target aarch64-apple-ios-sim)

echo "==> [4/5] Simulator static lib (x86_64-apple-ios, release)"
(cd "$RUST_ROOT" && cargo build -p uc-mobile --release --target x86_64-apple-ios)

# 5. Assemble xcframework
echo "==> [5/5] Assemble xcframework"
rm -rf "$XCFRAMEWORK_OUT"

# Combine simulator arches into universal binary
mkdir -p "$RUST_ROOT/target/sim-universal"
lipo -create \
  "$RUST_ROOT/target/aarch64-apple-ios-sim/release/libuc_mobile.a" \
  "$RUST_ROOT/target/x86_64-apple-ios/release/libuc_mobile.a" \
  -output "$RUST_ROOT/target/sim-universal/libuc_mobile.a"

xcodebuild -create-xcframework \
  -library "$RUST_ROOT/target/aarch64-apple-ios/release/libuc_mobile.a" \
  -headers "$BINDINGS_DIR/include" \
  -library "$RUST_ROOT/target/sim-universal/libuc_mobile.a" \
  -headers "$BINDINGS_DIR/include" \
  -output "$XCFRAMEWORK_OUT"

# Stage into Expo module
rm -rf "$MODULE_DIR/UniClipboardCore.xcframework"
cp -R "$XCFRAMEWORK_OUT" "$MODULE_DIR/"

mkdir -p "$MODULE_DIR/Bindings/include"
cp "$BINDINGS_DIR/uc_mobile.swift" "$MODULE_DIR/Bindings/"
cp "$BINDINGS_DIR/include/uc_mobileFFI.h" "$MODULE_DIR/Bindings/include/"
cp "$BINDINGS_DIR/include/module.modulemap" "$MODULE_DIR/Bindings/include/"

echo "Done. iOS artifacts staged in: $MODULE_DIR"
```

### 1.2 Expo Module Config

**`modules/uc-core/expo-module.config.json`**:
```json
{
  "platforms": ["ios", "android"],
  "name": "uc-core",
  "ios": {
    "modules": ["UcCoreModule"]
  },
  "android": {
    "modules": ["expo.modules.uccore.UcCoreModule"]
  }
}
```

### 1.3 Swift Expo Module Wrapper

The Swift module is a thin wrapper that:
- Calls `ucMobileInit()` once at module load
- Holds a singleton `MobileSyncClient` (same pattern as the native iOS app's `RustSyncCore.shared`)
- Exposes async methods via Expo Module API

```swift
// UcCoreModule.swift — Expo Module wrapping UniFFI Rust bindings
import ExpoModulesCore
import UniClipboardCore  // UniFFI-generated Swift module

public class UcCoreModule: Module {

    private static var initialized = false
    private var client: MobileSyncClient?

    private func ensureInit() {
        if !UcCoreModule.initialized {
            ucMobileInit()
            UcCoreModule.initialized = true
        }
    }

    private func getClient(trustInsecureCert: Bool) throws -> MobileSyncClient {
        if let c = client { return c }
        ensureInit()
        let bridge = ExpoPlatformBridge()
        let c = try MobileSyncClient(bridge: bridge, trustInsecureCert: trustInsecureCert)
        client = c
        return c
    }

    public func definition() -> ModuleDefinition {
        Name("UcCore")

        // --- Connect URI parsing (sync, pure) ---
        Function("parseConnectUri") { (uri: String) -> [String: Any] in
            let payload = try parseConnectUri(uri: uri)
            return [
                "v": payload.v,
                "url": payload.url,
                "urls": payload.urls,
                "user": payload.user,
                "pwd": payload.pwd,
                "other": payload.other
            ]
        }

        // --- Sync Client operations (async) ---
        AsyncFunction("getLatest") { (serverMap: [String: String],
                                       trustInsecureCert: Bool) -> [String: Any?] in
            let server = self.serverFromMap(serverMap)
            let meta = try await self.getClient(trustInsecureCert: trustInsecureCert)
                .getLatest(server: server)
            return self.metaToMap(meta)
        }

        AsyncFunction("putClipboard") { (serverMap: [String: String],
                                          metaMap: [String: Any?],
                                          payload: Data?,
                                          trustInsecureCert: Bool) in
            let server = self.serverFromMap(serverMap)
            let meta = self.metaFromMap(metaMap)
            try await self.getClient(trustInsecureCert: trustInsecureCert)
                .putClipboard(server: server, meta: meta,
                              payload: payload.map { [UInt8]($0) })
        }

        AsyncFunction("testConnection") { (serverMap: [String: String],
                                            trustInsecureCert: Bool) -> String in
            let server = self.serverFromMap(serverMap)
            let result = try await self.getClient(trustInsecureCert: trustInsecureCert)
                .testConnection(server: server, trustInsecureCert: trustInsecureCert)
            switch result {
            case .success: return "Success"
            case .authFailed: return "AuthFailed"
            case .unreachable: return "Unreachable"
            case .missingFields: return "MissingFields"
            }
        }

        AsyncFunction("queryHistory") { (serverMap: [String: String],
                                          queryMap: [String: Any?],
                                          trustInsecureCert: Bool) -> [[String: Any?]] in
            let server = self.serverFromMap(serverMap)
            let query = self.historyQueryFromMap(queryMap)
            let records = try await self.getClient(trustInsecureCert: trustInsecureCert)
                .queryHistory(server: server, query: query)
            return records.map { self.historyRecordToMap($0) }
        }

        AsyncFunction("getFile") { (serverMap: [String: String],
                                     name: String,
                                     trustInsecureCert: Bool) -> Data in
            let server = self.serverFromMap(serverMap)
            let bytes = try await self.getClient(trustInsecureCert: trustInsecureCert)
                .getFile(server: server, name: name)
            return Data(bytes)
        }

        AsyncFunction("putFile") { (serverMap: [String: String],
                                     name: String,
                                     body: Data,
                                     trustInsecureCert: Bool) in
            let server = self.serverFromMap(serverMap)
            try await self.getClient(trustInsecureCert: trustInsecureCert)
                .putFile(server: server, name: name, body: [UInt8](body))
        }

        AsyncFunction("getHistoryPayload") { (serverMap: [String: String],
                                               profileId: String,
                                               trustInsecureCert: Bool) -> Data in
            let server = self.serverFromMap(serverMap)
            let bytes = try await self.getClient(trustInsecureCert: trustInsecureCert)
                .getHistoryPayload(server: server, profileId: profileId)
            return Data(bytes)
        }

        AsyncFunction("probe") { (urls: [String],
                                    username: String,
                                    password: String,
                                    trustInsecureCert: Bool,
                                    timeoutMs: UInt32,
                                    networkEpoch: UInt64) -> [String: Any] in
            let report = try await self.getClient(trustInsecureCert: trustInsecureCert)
                .probe(urls: urls, username: username, password: password,
                       trustInsecureCert: trustInsecureCert,
                       timeoutMs: timeoutMs, networkEpoch: networkEpoch)
            var results: [String: String] = [:]
            for (url, result) in report.results {
                switch result {
                case .success: results[url] = "Success"
                case .authFailed: results[url] = "AuthFailed"
                case .unreachable: results[url] = "Unreachable"
                case .missingFields: results[url] = "MissingFields"
                }
            }
            return [
                "networkEpoch": report.networkEpoch,
                "results": results
            ]
        }

        Function("cancelInFlight") {
            self.client?.cancelInFlight()
        }

        // --- Sync Engine Reducer (pure, sync) ---
        Function("defaultSyncConfig") { () -> [String: Any] in
            return self.syncConfigToMap(defaultSyncConfig())
        }

        Function("defaultSyncRuntimeState") { () -> [String: Any?] in
            return self.syncRuntimeStateToMap(defaultSyncRuntimeState())
        }

        // ... planPreamble, planAfterServerGet, commit* functions
    }

    // MARK: - Type conversion helpers

    private func serverFromMap(_ map: [String: String]) -> ServerConfig {
        var base = (map["baseUrl"] ?? "").trimmingCharacters(in: .whitespaces)
        while base.hasSuffix("/") { base.removeLast() }
        return ServerConfig(
            baseUrl: base,
            username: map["username"] ?? "",
            password: map["password"] ?? ""
        )
    }

    private func metaToMap(_ meta: ClipboardMeta) -> [String: Any?] {
        var kindStr: String
        switch meta.kind {
        case .text: kindStr = "Text"
        case .image: kindStr = "Image"
        case .file: kindStr = "File"
        case .group: kindStr = "Group"
        }
        return [
            "kind": kindStr,
            "text": meta.text,
            "dataName": meta.dataName,
            "hasData": meta.hasData,
            "size": meta.size,
            "hash": meta.hash
        ]
    }

    private func metaFromMap(_ map: [String: Any?]) -> ClipboardMeta {
        let kindStr = map["kind"] as? String ?? "Text"
        let kind: ClipboardKind = switch kindStr {
        case "Image": .image
        case "File": .file
        case "Group": .group
        default: .text
        }
        return ClipboardMeta(
            kind: kind,
            text: map["text"] as? String ?? "",
            dataName: map["dataName"] as? String,
            hasData: map["hasData"] as? Bool ?? false,
            size: (map["size"] as? NSNumber)?.uint64Value ?? 0,
            hash: map["hash"] as? String
        )
    }

    private func historyQueryFromMap(_ map: [String: Any?]) -> HistoryQuery {
        return HistoryQuery(
            page: (map["page"] as? NSNumber)?.int64Value,
            beforeMs: (map["beforeMs"] as? NSNumber)?.int64Value,
            afterMs: (map["afterMs"] as? NSNumber)?.int64Value,
            modifiedAfterMs: (map["modifiedAfterMs"] as? NSNumber)?.int64Value,
            types: (map["types"] as? NSNumber)?.int64Value,
            searchText: map["searchText"] as? String,
            starred: map["starred"] as? Bool,
            sortByLastAccessed: map["sortByLastAccessed"] as? Bool
        )
    }

    private func historyRecordToMap(_ r: HistoryRecord) -> [String: Any?] {
        var kindStr: String
        switch r.kind {
        case .text: kindStr = "Text"
        case .image: kindStr = "Image"
        case .file: kindStr = "File"
        case .group: kindStr = "Group"
        }
        return [
            "hash": r.hash,
            "kind": kindStr,
            "text": r.text,
            "hasData": r.hasData,
            "size": r.size,
            "createTimeMs": r.createTimeMs,
            "lastModifiedMs": r.lastModifiedMs,
            "lastAccessedMs": r.lastAccessedMs,
            "starred": r.starred,
            "pinned": r.pinned,
            "version": r.version,
            "isDeleted": r.isDeleted
        ]
    }

    private func syncConfigToMap(_ c: SyncConfig) -> [String: Any] { [:] }
    private func syncRuntimeStateToMap(_ s: SyncRuntimeState) -> [String: Any?] { [:] }
}

// MARK: - PlatformBridge implementation

class ExpoPlatformBridge: PlatformBridge {
    func appGroupDir() -> String {
        // iOS app group container for sharing data with extensions
        let url = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: "group.app.uniclipboard.ios"
        )
        return url?.path ?? NSTemporaryDirectory()
    }
}
```

### 1.4 Config Plugin for xcframework Linking

Expo's auto-linking may not pick up the xcframework automatically.
A config plugin ensures proper linking:

```js
// plugins/build/withRustCore.js
const { withXcodeProject } = require('@expo/config-plugins');

module.exports = function withRustCore(config) {
  return withXcodeProject(config, async (config) => {
    const project = config.modResults;
    // Add framework search path for UniClipboardCore.xcframework
    // Add linker flags: -luc_mobile (static lib from xcframework)
    // This may not be needed if expo-module auto-linking handles it.
    return config;
  });
};
```

### 1.5 Binary Distribution for iOS

The xcframework is ~70 MB — too large to commit directly. Options:

**Option A: Git LFS** — track `modules/uc-core/ios/UniClipboardCore.xcframework/` via LFS.

**Option B: gitignore + local build only** — `.gitignore` the xcframework; every developer
runs `rust-core/scripts/build-ios.sh` locally. CI/EAS Build runs the same script
(requires Rust toolchain in the build environment).

**Option C: Pinned download** — publish xcframework to GitHub Releases; download during build.

Since the Rust source is in-repo, Option A or B is most natural. Option B is simplest to
start with; switch to A or C when binary distribution matters for CI.

## Phase 2: Android Integration

### 2.1 Build Pipeline (`rust-core/scripts/build-android.sh`)

```bash
#!/usr/bin/env bash
# Cross-compile uc-mobile for Android targets and generate Kotlin bindings
# from local rust-core/ source.
#
# Prerequisites:
#   - cargo-ndk: cargo install cargo-ndk
#   - Android NDK (via Android Studio or ANDROID_NDK_HOME)
#   - Rust targets: rustup target add \
#       aarch64-linux-android armv7-linux-androideabi x86_64-linux-android

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUST_ROOT="$REPO_ROOT/rust-core"
OUTPUT_DIR="$REPO_ROOT/modules/uc-core/android"
BINDINGS_DIR="$OUTPUT_DIR/src/main/java"
JNILIB_DIR="$OUTPUT_DIR/src/main/jniLibs"

# 1. Build host cdylib for bindgen
echo "==> [1/3] Host cdylib (for uniffi-bindgen)"
(cd "$RUST_ROOT" && cargo build -p uc-mobile)

# 2. Generate Kotlin bindings
echo "==> [2/3] Kotlin bindings (uniffi-bindgen library mode)"
(cd "$RUST_ROOT" && cargo run -p uc-mobile --features bindgen-cli --bin uniffi-bindgen -- \
  generate --library target/debug/libuc_mobile.dylib \
  --language kotlin --out-dir "$BINDINGS_DIR")

# 3. Cross-compile .so for each ABI
echo "==> [3/3] Cross-compile (cargo-ndk)"
(cd "$RUST_ROOT" && cargo ndk \
  -t arm64-v8a \
  -t armeabi-v7a \
  -t x86_64 \
  -o "$JNILIB_DIR" \
  build -p uc-mobile --release)

echo "Done. Artifacts in: $OUTPUT_DIR"
```

### 2.2 Android Gradle (`android/build.gradle`)

```groovy
plugins {
  id 'com.android.library'
  id 'expo-module-gradle-plugin'
}

group = 'com.jericx.syncclipboardmobile'
version = '1.0.0'

android {
  namespace "expo.modules.uccore"
  defaultConfig {
    versionCode 1
    versionName "1.0.0"
    ndk {
      abiFilters 'arm64-v8a', 'armeabi-v7a', 'x86_64'
    }
  }
  sourceSets {
    main {
      jniLibs.srcDirs = ['src/main/jniLibs']
    }
  }
}

dependencies {
  implementation 'com.facebook.react:react-native:0.83.2'
  // UniFFI Kotlin bindings use JNA to call into the Rust .so
  implementation 'net.java.dev.jna:jna:5.14.0@aar'
}
```

### 2.3 Kotlin Expo Module Wrapper

```kotlin
// UcCoreModule.kt — Expo Module wrapping UniFFI Rust bindings
package expo.modules.uccore

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import kotlinx.coroutines.*
import uniffi.uc_mobile.*

class UcCoreModule : Module() {

    companion object {
        private var initialized = false
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var client: MobileSyncClient? = null

    private fun ensureInit() {
        if (!initialized) {
            ucMobileInit()
            initialized = true
        }
    }

    private fun getClient(trustInsecureCert: Boolean): MobileSyncClient {
        return client ?: run {
            ensureInit()
            val bridge = AndroidPlatformBridge(appContext)
            MobileSyncClient(bridge, trustInsecureCert).also { client = it }
        }
    }

    override fun definition() = ModuleDefinition {
        Name("UcCore")

        // --- Connect URI parsing (sync, pure) ---
        Function("parseConnectUri") { uri: String ->
            val payload = parseConnectUri(uri)
            mapOf(
                "v" to payload.v,
                "url" to payload.url,
                "urls" to payload.urls,
                "user" to payload.user,
                "pwd" to payload.pwd,
                "other" to payload.other
            )
        }

        // --- Sync Client operations (async) ---
        AsyncFunction("getLatest") { serverMap: Map<String, String>,
                                      trustInsecureCert: Boolean, promise: Promise ->
            scope.launch {
                try {
                    val server = serverFromMap(serverMap)
                    val meta = getClient(trustInsecureCert).getLatest(server)
                    promise.resolve(metaToMap(meta))
                } catch (e: SyncException) {
                    promise.reject("SYNC_ERROR", syncErrorMessage(e), null)
                }
            }
        }

        AsyncFunction("putClipboard") { serverMap: Map<String, String>,
                                         metaMap: Map<String, Any?>,
                                         payload: ByteArray?,
                                         trustInsecureCert: Boolean, promise: Promise ->
            scope.launch {
                try {
                    val server = serverFromMap(serverMap)
                    val meta = metaFromMap(metaMap)
                    getClient(trustInsecureCert).putClipboard(server, meta, payload?.toList())
                    promise.resolve(null)
                } catch (e: SyncException) {
                    promise.reject("SYNC_ERROR", syncErrorMessage(e), null)
                }
            }
        }

        AsyncFunction("testConnection") { serverMap: Map<String, String>,
                                           trustInsecureCert: Boolean, promise: Promise ->
            scope.launch {
                try {
                    val server = serverFromMap(serverMap)
                    val result = getClient(trustInsecureCert)
                        .testConnection(server, trustInsecureCert)
                    promise.resolve(result.name)
                } catch (e: Exception) {
                    promise.reject("PROBE_ERROR", e.message, null)
                }
            }
        }

        Function("cancelInFlight") {
            client?.cancelInFlight()
        }

        // ... queryHistory, getFile, putFile, probe, reducer functions
    }
}

// MARK: - PlatformBridge implementation

class AndroidPlatformBridge(
    private val appContext: expo.modules.kotlin.AppContext
) : PlatformBridge {
    override fun appGroupDir(): String {
        return appContext.reactContext?.filesDir?.absolutePath ?: ""
    }
}

// MARK: - Type conversion helpers

private fun serverFromMap(map: Map<String, String>): ServerConfig {
    var base = (map["baseUrl"] ?: "").trim()
    while (base.endsWith("/")) base = base.dropLast(1)
    return ServerConfig(
        baseUrl = base,
        username = map["username"] ?: "",
        password = map["password"] ?: ""
    )
}

private fun metaToMap(meta: ClipboardMeta): Map<String, Any?> = mapOf(
    "kind" to meta.kind.name,
    "text" to meta.text,
    "dataName" to meta.dataName,
    "hasData" to meta.hasData,
    "size" to meta.size,
    "hash" to meta.hash
)

private fun metaFromMap(map: Map<String, Any?>): ClipboardMeta {
    val kind = when (map["kind"] as? String) {
        "Image" -> ClipboardKind.IMAGE
        "File" -> ClipboardKind.FILE
        "Group" -> ClipboardKind.GROUP
        else -> ClipboardKind.TEXT
    }
    return ClipboardMeta(
        kind = kind,
        text = map["text"] as? String ?: "",
        dataName = map["dataName"] as? String,
        hasData = map["hasData"] as? Boolean ?: false,
        size = (map["size"] as? Number)?.toLong()?.toULong() ?: 0u,
        hash = map["hash"] as? String
    )
}

private fun syncErrorMessage(e: SyncException): String = e.message ?: "Unknown sync error"
```

### 2.4 Binary Distribution for Android

The `.so` files are small (~4 MB per ABI, ~12 MB total). **Commit directly** to
`modules/uc-core/android/src/main/jniLibs/`.

## Phase 3: Sync Engine Decision Reducer

The `uc-mobile` reducer functions are pure (no I/O), making them ideal for cross-FFI calls:

```typescript
// Exposed from the same module
export function defaultSyncConfig(): SyncConfig { ... }
export function defaultSyncRuntimeState(): SyncRuntimeState { ... }
export function planPreamble(state: SyncRuntimeState, snap: PreambleSnapshot): PreambleStep { ... }
export function planAfterServerGet(state: SyncRuntimeState, snap: ServerGetSnapshot): ServerRoute { ... }
export function commitConverged(state: SyncRuntimeState, serverHash: string | null): SyncRuntimeState { ... }
// ... all other commit/plan/helper functions
```

These replace any TypeScript reimplementation of sync logic, ensuring parity with iOS.

## TypeScript API (`modules/uc-core/src/index.ts`)

```typescript
import { requireNativeModule } from 'expo-modules-core';

const NativeModule = requireNativeModule('UcCore');

// --- Types ---
export interface ServerConfig {
  baseUrl: string;
  username: string;
  password: string;
}

export interface ClipboardMeta {
  kind: 'Text' | 'Image' | 'File' | 'Group';
  text: string;
  dataName: string | null;
  hasData: boolean;
  size: number;
  hash: string | null;
}

export interface ConnectPayload {
  v: number;
  url: string;
  urls: string[];
  user: string;
  pwd: string;
  other: Record<string, string>;
}

export interface HistoryQuery {
  page?: number;
  beforeMs?: number;
  afterMs?: number;
  modifiedAfterMs?: number;
  types?: number;          // bitmask: Text=1, Image=2, File=4, Group=8
  searchText?: string;
  starred?: boolean;
  sortByLastAccessed?: boolean;
}

export interface HistoryRecord {
  hash: string;
  kind: 'Text' | 'Image' | 'File' | 'Group';
  text: string | null;
  hasData: boolean;
  size: number | null;
  createTimeMs: number | null;
  lastModifiedMs: number | null;
  lastAccessedMs: number | null;
  starred: boolean;
  pinned: boolean;
  version: number | null;
  isDeleted: boolean;
}

export type ProbeResult = 'Success' | 'AuthFailed' | 'Unreachable' | 'MissingFields';

export interface ProbeReport {
  networkEpoch: number;
  results: Record<string, ProbeResult>;
}

// --- Functions ---

export function parseConnectUri(uri: string): ConnectPayload {
  return NativeModule.parseConnectUri(uri);
}

export async function getLatest(
  server: ServerConfig,
  trustInsecureCert = false
): Promise<ClipboardMeta> {
  return NativeModule.getLatest(server, trustInsecureCert);
}

export async function putClipboard(
  server: ServerConfig,
  meta: ClipboardMeta,
  payload?: ArrayBuffer,
  trustInsecureCert = false
): Promise<void> {
  return NativeModule.putClipboard(server, meta, payload ?? null, trustInsecureCert);
}

export async function testConnection(
  server: ServerConfig,
  trustInsecureCert = false
): Promise<ProbeResult> {
  return NativeModule.testConnection(server, trustInsecureCert);
}

export async function queryHistory(
  server: ServerConfig,
  query: HistoryQuery,
  trustInsecureCert = false
): Promise<HistoryRecord[]> {
  return NativeModule.queryHistory(server, query, trustInsecureCert);
}

export async function getFile(
  server: ServerConfig,
  name: string,
  trustInsecureCert = false
): Promise<ArrayBuffer> {
  return NativeModule.getFile(server, name, trustInsecureCert);
}

export async function putFile(
  server: ServerConfig,
  name: string,
  body: ArrayBuffer,
  trustInsecureCert = false
): Promise<void> {
  return NativeModule.putFile(server, name, body, trustInsecureCert);
}

export async function getHistoryPayload(
  server: ServerConfig,
  profileId: string,
  trustInsecureCert = false
): Promise<ArrayBuffer> {
  return NativeModule.getHistoryPayload(server, profileId, trustInsecureCert);
}

export async function probe(
  urls: string[],
  username: string,
  password: string,
  trustInsecureCert = false,
  timeoutMs = 3000,
  networkEpoch = 0
): Promise<ProbeReport> {
  return NativeModule.probe(urls, username, password, trustInsecureCert, timeoutMs, networkEpoch);
}

export function cancelInFlight(): void {
  NativeModule.cancelInFlight();
}
```

## Build & Development Workflow

### Local Development

```bash
# First time: build Rust artifacts from rust-core/ source
./rust-core/scripts/build-ios.sh       # → xcframework + Swift bindings (priority)
./rust-core/scripts/build-android.sh   # → .so files + Kotlin bindings

# Run the app (development build, NOT Expo Go)
npx expo prebuild --clean
npx expo run:ios
npx expo run:android
```

### CI / EAS Build

Since Rust source is in-repo, CI can build from source if Rust toolchain is available.
Alternatively, cache the build artifacts between CI runs to avoid rebuilding every time.

**Android**: `.so` files can be committed to repo (~12 MB total) for zero-setup CI.

**iOS**: xcframework is too large to commit; CI must either build from source or
download a pre-built artifact.

## Migration Path (from current JS → Rust)

The current project does sync via TypeScript (`axios` + SignalR). Migration order:

| Step | Current (TS) | Target (Rust via uc-core) | Risk |
|---|---|---|---|
| 1 | QR connect URI parsing (manual) | `parseConnectUri()` | None (pure fn) |
| 2 | Connection testing (axios) | `testConnection()` / `probe()` | Low |
| 3 | `axios` GET SyncClipboard.json | `getLatest()` | Medium |
| 4 | `axios` PUT SyncClipboard.json | `putClipboard()` | Medium |
| 5 | History query (axios POST) | `queryHistory()` / `getHistoryPayload()` | Medium |
| 6 | File upload/download (NativeUtil) | `putFile()` / `getFile()` | Medium |
| 7 | Sync decision logic (if any in TS) | Reducer functions | Low (Phase 3) |

SignalR push notifications remain in JS (`@microsoft/signalr`) — the Rust core handles
pull-based sync only.

## Key Decisions

1. **JNA (Android)**: UniFFI Kotlin bindings use JNA. Adds ~1.5 MB to APK but avoids
   hand-written JNI.

2. **Singleton lifecycle**: One `MobileSyncClient` per process, created on first use.
   Server config is passed per-call (not per-client), matching the iOS native app pattern.

3. **Error mapping**: Rust `SyncError` variants → JS error codes via promise rejection.
   The Swift/Kotlin wrapper maps each variant to a structured error.

4. **Binary size impact**:
   - iOS: ~4 MB added to IPA (static lib, single arch after App Thinning)
   - Android: ~4 MB per ABI variant (with ABI splits)

5. **Expo Go incompatibility**: The app already requires development builds (has multiple
   native modules), so this is not a new constraint.

## Syncing Rust Source from Upstream

When the upstream `uniclipboard` monorepo updates `uc-mobile` or `uc-mobile-proto`,
sync the changes into `rust-core/crates/`:

```bash
# From upstream monorepo
cp -R ~/MyProjects/uniclipboard/crates/uc-mobile/src     rust-core/crates/uc-mobile/src
cp    ~/MyProjects/uniclipboard/crates/uc-mobile/Cargo.toml rust-core/crates/uc-mobile/Cargo.toml
cp -R ~/MyProjects/uniclipboard/crates/uc-mobile-proto/src  rust-core/crates/uc-mobile-proto/src
cp    ~/MyProjects/uniclipboard/crates/uc-mobile-proto/Cargo.toml rust-core/crates/uc-mobile-proto/Cargo.toml
```

Then adjust the workspace-level Cargo.toml if any dependency versions changed.
The `uc-mobile` Cargo.toml needs `version.workspace = true` lines replaced with
explicit versions (since it's no longer in the upstream workspace).

Consider using `git subtree` for automated sync if this becomes frequent.

## Prerequisites

- Rust toolchain: `rustup` with stable channel
- For iOS: Xcode, `rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios`
- For Android: NDK, `cargo-ndk`, `rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android`
