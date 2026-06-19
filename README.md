# UniClip

Multi-device clipboard sync mobile client, currently only supports Android.

## Features

### Clipboard Sync & History

- Text, image, and single-file clipboard sync
  - Manual sync via notification shortcut, home screen shortcut, or share menu
  - Background automatic clipboard sync
- History sync across devices
- Auto-upload SMS verification codes

### Server Support

- **SyncClipboard protocol server**
- **WebDAV server**
- **S3 object storage**

## Screenshots

<p align="center">
  <img src="docs/screenshorts/Screenshot01.jpg" width="250" alt="Home" />
  <img src="docs/screenshorts/Screenshot02.jpg" width="250" alt="History" />
  <img src="docs/screenshorts/Screenshot03.jpg" width="250" alt="Settings" />
</p>

## Development

### Install dependencies

```bash
npm install
```

### Generate native projects

```bash
npm run prebuild
```

### Run in development

```bash
# Android
npm run android

# iOS
npm run ios
```

### Build APK

```bash
npm run build:apk
```

### Other commands

```bash
# Type checking
npm run type-check

# Lint
npm run lint

# Auto-fix code issues
npm run lint:fix

# Format docs (JSON/Markdown)
npm run format-docs

# Build Expo native plugins
npm run plugin:build
```

## Release & Versioning

See [docs/RELEASE.md](./docs/RELEASE.md) for release process, versioning strategy, and upstream sync workflow.

## Acknowledgments

UniClip is built upon the following open-source projects:

- [Jeric-X/SyncClipboard](https://github.com/Jeric-X/SyncClipboard) — Original SyncClipboard protocol and desktop implementation (MIT)
- [Jeric-X/syncclipboard-mobile](https://github.com/Jeric-X/syncclipboard-mobile) — Original mobile implementation (MIT, by JericX)

UniClip is compatible with the SyncClipboard protocol and can work with SyncClipboard servers.

## Open Source Dependencies

### JavaScript / TypeScript

| Repository | Description |
|---|---|
| [facebook/react-native](https://github.com/facebook/react-native) | Cross-platform mobile framework |
| [expo/expo](https://github.com/expo/expo) | React Native toolchain and native modules |
| [react-navigation/react-navigation](https://github.com/react-navigation/react-navigation) | Navigation library |
| [pmndrs/zustand](https://github.com/pmndrs/zustand) | Lightweight state management |
| [Shopify/flash-list](https://github.com/Shopify/flash-list) | High-performance list rendering |
| [software-mansion/react-native-reanimated](https://github.com/software-mansion/react-native-reanimated) | Animation library |
| [software-mansion/react-native-gesture-handler](https://github.com/software-mansion/react-native-gesture-handler) | Gesture handling |
| [software-mansion/react-native-screens](https://github.com/software-mansion/react-native-screens) | Native navigation screen containers |
| [th3rdwave/react-native-safe-area-context](https://github.com/th3rdwave/react-native-safe-area-context) | Safe area insets |
| [callstack/react-native-pager-view](https://github.com/callstack/react-native-pager-view) | Native pager view |
| [satya164/react-native-tab-view](https://github.com/satya164/react-native-tab-view) | Tab view |
| [react-native-async-storage/async-storage](https://github.com/react-native-async-storage/async-storage) | Local key-value storage |
| [react-native-netinfo/react-native-netinfo](https://github.com/react-native-netinfo/react-native-netinfo) | Network status listener |
| [axios/axios](https://github.com/axios/axios) | HTTP client |
| [dotnet/aspnetcore (SignalR)](https://github.com/dotnet/aspnetcore) | Real-time push client |
| [expo/vector-icons](https://github.com/expo/vector-icons) | Vector icon library |
| [jiang0508/react-native-feather](https://github.com/jiang0508/react-native-feather) | Feather icon component |
| [onubo/react-native-logs](https://github.com/onubo/react-native-logs) | Logging utility |
| [margelo/react-native-worklets](https://github.com/margelo/react-native-worklets) | JS Worklets runtime |
| [emn178/js-sha256](https://github.com/emn178/js-sha256) | SHA-256 hashing |
| [linonetwo/segmentit](https://github.com/linonetwo/segmentit) | Chinese word segmentation (word picker) |

### Android

| Repository | Description |
|---|---|
| [facebook/react-native](https://github.com/facebook/react-native) | React Native Android runtime |
| [facebook/hermes](https://github.com/facebook/hermes) | Hermes JavaScript engine |
| [react-native-community/jsc-android-buildscripts](https://github.com/react-native-community/jsc-android-buildscripts) | JavaScriptCore engine (fallback) |
| [RikkaApps/Shizuku](https://github.com/RikkaApps/Shizuku) | Shizuku API: system API access without root |
| [dotnet/aspnetcore (SignalR Java Client)](https://github.com/dotnet/aspnetcore) | SignalR real-time push (Java/Android) |
| [google/gson](https://github.com/google/gson) | JSON serialization (SignalR protocol) |

## License

This project includes the following copyright notices:

- Copyright (c) 2026 JericX (upstream SyncClipboard author)
- Copyright (c) 2026 mkdir700 (UniClip)

See [LICENSE](./LICENSE) for details.
