# UniClip

跨端剪贴板同步客户端，支持 **Android**（已出货）与 **iOS**（TestFlight 内测中）。基于 SyncClipboard 协议，也可对接 WebDAV 与 S3 对象存储自建同步。

> UniClip 起源于 [Jeric-X/syncclipboard-mobile](https://github.com/Jeric-X/syncclipboard-mobile)，自 `1.0.11` 快照点起独立演进，目前已与上游是两套不同的实现：新增 iOS 端、Rust 同步核心、SSE 实时推送、SQLite 历史存储与完整国际化。

## 功能特性

### 剪贴板同步

- 文本、图片、单文件的跨设备同步
- 多种触发方式：
  - 通知栏快捷操作 / 前台服务保活
  - 桌面 pin 快捷方式、快速设置磁贴（Quick Settings Tile）
  - 系统分享菜单（Share Intent）、Android 划词菜单（Process Text）
  - iOS 分享扩展与自定义键盘扩展（经 App Group 与主 App 共享数据）
  - 后台自动同步
- 复制即同步：Android 授予 `READ_LOGS` 后启用事件驱动监听，替代 1Hz 轮询空转（无权限时自动回落轮询）
- 短信验证码自动转发上传

### 便捷接入

- 扫码配对：摄像头扫描二维码快速添加服务器
- 首次运行引导（Onboarding）
- 深度链接：`connect` 深链直接预填「添加服务器」表单
- 完整国际化（简体中文 / English）

### 服务器支持

- **SyncClipboard 协议服务器**
- **WebDAV 服务器**
- **S3 对象存储**

## 截图

<p align="center">
  <img src="docs/screenshorts/Screenshot01.jpg" width="250" alt="首页" />
  <img src="docs/screenshorts/Screenshot02.jpg" width="250" alt="历史记录" />
  <img src="docs/screenshorts/Screenshot03.jpg" width="250" alt="设置" />
</p>

## 架构概览

- **同步核心**：Rust `uc-mobile`（UniFFI）编译为静态/动态库，通过本地 Expo 模块 `modules/uc-core` 暴露给 TS 层，Android / iOS 共用同一份同步逻辑。详见 [docs/RUST_CORE_INTEGRATION.md](./docs/RUST_CORE_INTEGRATION.md)。
- **实时推送**：由 Rust 核心提供的 SSE（Server-Sent Events）驱动即时下行，在线时把周期 tick 降为兜底、断开时回落 1Hz 轮询（已移除 SignalR）。
- **本地存储**：历史记录持久化到 SQLite；iOS 通过共享 App Group 与原生 Swift 端共用同一份历史数据。
- **平台分离 UI**：所有跨平台差异的组件按 Metro 平台文件拆分——
  - iOS：Liquid Glass / SwiftUI（`@expo/ui`、`expo-glass-effect`、`lucide-react-native`）
  - Android：Material Design 3 / Jetpack Compose（`@expo/ui/jetpack-compose`、Ionicons）
- **自研原生模块**（`modules/`）：`uc-core`、`foreground-service`、`native-timer`、`clipboard-overlay`、`app-group-store`、`native-util`、`qr-scanner`、`shortcut`、`sms-forwarder`。

## 开发

> Expo 版本变动较大，写代码前请先阅读对应版本文档：<https://docs.expo.dev/versions/v56.0.0/>

### 安装依赖

```bash
npm install
```

### 生成原生项目

```bash
npm run prebuild
```

### 调试运行

```bash
# Android
npm run android

# iOS
npm run ios
```

### 构建 APK

```bash
npm run build:apk
```

### 其他命令

```bash
# 单元测试
npm test

# 类型检查
npm run type-check

# 代码检查 / 自动修复
npm run lint
npm run lint:fix

# 格式化文档（JSON / Markdown）
npm run format-docs

# 构建 Expo 原生插件
npm run plugin:build
```

## 发布与版本号

发版流程、版本号策略、上游同步工作流见 [docs/RELEASE.md](./docs/RELEASE.md)。iOS 本地构建并上传 TestFlight 的流程见 [docs/ios-release-ci.md](./docs/ios-release-ci.md)。

## 致谢

UniClip 基于以下开源项目改进，特此致谢：

- [Jeric-X/SyncClipboard](https://github.com/Jeric-X/SyncClipboard) — 原始 SyncClipboard 协议与桌面端实现（MIT）
- [Jeric-X/syncclipboard-mobile](https://github.com/Jeric-X/syncclipboard-mobile) — 移动端原始实现（MIT，作者 JericX）

UniClip 兼容 SyncClipboard 协议，可与 SyncClipboard 服务端配合使用。

## 开源依赖

### JavaScript / TypeScript 依赖

| 仓库                                                                                                              | 说明                           |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| [facebook/react-native](https://github.com/facebook/react-native)                                                 | 跨平台移动框架                 |
| [expo/expo](https://github.com/expo/expo)                                                                         | React Native 工具链与原生模块  |
| [react-navigation/react-navigation](https://github.com/react-navigation/react-navigation)                         | 导航库                         |
| [pmndrs/zustand](https://github.com/pmndrs/zustand)                                                               | 轻量状态管理                   |
| [i18next/i18next](https://github.com/i18next/i18next)                                                             | 国际化框架                     |
| [i18next/react-i18next](https://github.com/i18next/react-i18next)                                                 | React 国际化绑定               |
| [Shopify/flash-list](https://github.com/Shopify/flash-list)                                                       | 高性能列表渲染                 |
| [software-mansion/react-native-reanimated](https://github.com/software-mansion/react-native-reanimated)           | 动画库                         |
| [software-mansion/react-native-gesture-handler](https://github.com/software-mansion/react-native-gesture-handler) | 手势处理                       |
| [software-mansion/react-native-screens](https://github.com/software-mansion/react-native-screens)                 | 原生导航屏幕容器               |
| [th3rdwave/react-native-safe-area-context](https://github.com/th3rdwave/react-native-safe-area-context)           | 安全区域适配                   |
| [callstack/react-native-pager-view](https://github.com/callstack/react-native-pager-view)                         | 原生分页视图                   |
| [satya164/react-native-tab-view](https://github.com/satya164/react-native-tab-view)                               | Tab 切换视图                   |
| [react-native-async-storage/async-storage](https://github.com/react-native-async-storage/async-storage)           | 本地键值存储                   |
| [react-native-netinfo/react-native-netinfo](https://github.com/react-native-netinfo/react-native-netinfo)         | 网络状态监听                   |
| [axios/axios](https://github.com/axios/axios)                                                                     | HTTP 客户端                    |
| [software-mansion/react-native-svg](https://github.com/software-mansion/react-native-svg)                         | SVG 渲染                       |
| [lucide-icons/lucide](https://github.com/lucide-icons/lucide)                                                     | 图标库（iOS，近似 SF Symbols） |
| [expo/vector-icons](https://github.com/expo/vector-icons)                                                         | 矢量图标库（Android）          |
| [jiang0508/react-native-feather](https://github.com/jiang0508/react-native-feather)                               | Feather 图标组件               |
| [onubo/react-native-logs](https://github.com/onubo/react-native-logs)                                             | 日志工具                       |
| [margelo/react-native-worklets](https://github.com/margelo/react-native-worklets)                                 | JS Worklets 运行时             |
| [emn178/js-sha256](https://github.com/emn178/js-sha256)                                                           | SHA-256 哈希计算               |
| [linonetwo/segmentit](https://github.com/linonetwo/segmentit)                                                     | 中文分词（词语选取功能）       |

### 原生依赖

| 仓库                                                              | 说明                                     |
| ----------------------------------------------------------------- | ---------------------------------------- |
| [facebook/react-native](https://github.com/facebook/react-native) | React Native Android / iOS 运行时        |
| [facebook/hermes](https://github.com/facebook/hermes)             | Hermes JavaScript 引擎                   |
| [mozilla/uniffi-rs](https://github.com/mozilla/uniffi-rs)         | Rust ↔ Swift/Kotlin 绑定生成（同步核心） |

## 许可协议

本项目包含以下版权声明：

- Copyright (c) 2026 JericX（上游 SyncClipboard 原作者）
- Copyright (c) 2026 mkdir700（UniClip）

详见 [LICENSE](./LICENSE)。
