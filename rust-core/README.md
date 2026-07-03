# Rust Core Build Orchestration

Scripts that build the `uc-mobile` Rust crate from the upstream
[uniclipboard](https://github.com/nicepkg/uniclipboard) monorepo and stage
compiled binaries + UniFFI-generated bindings into `modules/uc-core/`.

## Prerequisites

### Rust Toolchain

```bash
# Install Rust (if not already)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# iOS targets
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios

# Android targets
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android

# cargo-ndk (Android cross-compilation)
cargo install cargo-ndk
```

### Platform Tools

- **iOS**: Xcode with iOS SDK
- **Android**: Android NDK (via Android Studio or `ANDROID_NDK_HOME`)

## Environment

| Variable       | Default                     | Description                       |
| -------------- | --------------------------- | --------------------------------- |
| `UC_RUST_REPO` | `~/MyProjects/uniclipboard` | Path to the uniclipboard monorepo |

## Usage

```bash
# Build iOS xcframework + Swift bindings
./rust-core/scripts/build-ios.sh

# Build Android .so + Kotlin bindings
./rust-core/scripts/build-android.sh

# Build both platforms
./rust-core/scripts/update-bindings.sh

# Build one platform only
./rust-core/scripts/update-bindings.sh ios
./rust-core/scripts/update-bindings.sh android
```

## Output

### iOS (`modules/uc-core/ios/`)

| File                                | Description                                 |
| ----------------------------------- | ------------------------------------------- |
| `UniClipboardCore.xcframework/`     | Static library (device + simulator + macOS) |
| `Bindings/uc_mobile.swift`          | UniFFI-generated Swift bindings             |
| `Bindings/include/uc_mobileFFI.h`   | C header                                    |
| `Bindings/include/module.modulemap` | Clang module map                            |

### Android (`modules/uc-core/android/`)

| File                                          | Description                      |
| --------------------------------------------- | -------------------------------- |
| `src/main/jniLibs/{abi}/libuc_mobile.so`      | Shared library per ABI           |
| `src/main/java/uniffi/uc_mobile/uc_mobile.kt` | UniFFI-generated Kotlin bindings |

## Binary Distribution

- **iOS**: xcframework is gitignored (~70 MB). Run `build-ios.sh` locally.
- **Android**: `.so` files are committed (~12 MB total). Re-run `build-android.sh` when Rust code changes.
