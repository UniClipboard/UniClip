# PRD — 双端统一分享流程:哑扩展/哑接收 + 主应用内分享页

状态:待评审
负责人:移动端(iOS 分享扩展 + Android 分享接收 + React Native 主应用层)
平台:iOS 与 Android,共用同一套分享流程。
相关方:iOS 分享扩展(`targets/share/`)、`app-group-store` 原生模块、
`expo-sharing`(Android intent 接收)、React Native 主应用。

---

## 1. 背景

### 1.1 iOS:扩展是完整产品界面

当前 iOS 分享扩展(`targets/share/ShareRootView.swift`,550 行)是一个功能完整的
分享界面:加载附件、通过 `ExtensionP2pClient` 列出已配对设备、在扩展进程内完成
整个 P2P 发送(`ShareUploader.swift` → `ExtensionSyncRouter` → `UcEngineCore`)。

结构性问题:

1. **扩展进程受限**。iOS 扩展运行在内存受限、有严格启动时限的进程中。超过
   100 MB 的大文件(`OutboundShareStore.directSendLimitBytes`)已无法在扩展内直接
   发送,只能退化为 "handoff" 流程:文件暂存到 App Group,提示用户手动打开主应用
   (`ShareRootView.swift` 的 `.handedOff` 阶段)。此外,只要扩展未能在时限内呈现
   出自己的界面(启动慢、崩溃、被 jetsam 杀掉),分享面板就会一直显示系统占位文案
   "This content is waiting to be sent"。
2. **接收设备界面重复且状态陈旧**。扩展用 `ExtensionP2pClient.recipients()` 自己
   维护一份设备列表(在线/离线取自上次已知状态),而主应用已经拥有实时的空间快照
   (`useUnifiedSpaceStore` / `UnifiedSpaceService.listDevices`,含每台设备的
   `online` 字段)。同一份空间数据存在两个事实来源。
3. **存在两条 P2P 发送链路**。扩展启动自己的引擎会话来发送;主应用侧另有一套
   更完善、可观测的链路(`UnifiedContentService.sendImportedText` /
   `sendImportedAsset`,配合 `OutboundDeliveryCoordinator`、投递状态持久化,
   以及 `importTextToHistory` / `importFileToHistory` 的历史落库)。

### 1.2 Android:自动落库即发,无预览无设备选择

当前 Android 分享接收(`src/screens/ShareReceiveScreen.tsx`)由 `expo-sharing`
模块承接系统 `ACTION_SEND` intent(主 Activity 直接被系统启动/前台化),流程为:
解析 intent → 落库(`importTextToHistory` / `importFileToHistory`)→
**自动发送到当前空间全部设备** → 立即 `moveTaskToBack()` 返回来源应用
(`App.tsx` 的 `shareReceiveOverlay` 机制)。

问题:

1. **无法选择接收设备**。内容自动推给空间内所有在线设备,与用户在 iOS 端
   选择设备的体验不一致,也没有离线设备列表可确认。
2. **无内容预览**。用户只能看到转圈,看不到即将发送的是什么。
3. **发送结果不可见**。`moveTaskToBack` 立即退回来源应用,失败只弹一个 toast,
   用户无法确认是否送达。
4. **双端体验分裂**。两端分享流程完全不同(iOS 选设备发送 vs Android 自动群发),
   需要两套维护成本。

### 1.3 已有的可复用基础

- **iOS App Group 暂存**:`OutboundShareStore`(分别存在于
  `targets/share/OutboundShareHandoff.swift` 与
  `modules/app-group-store/ios/Shared/OutboundShareHandoff.swift`)管理
  `outbound-handoff/{files,pending,processing}`,提供 claim/release/complete
  语义、7 天过期和原子写入的 payload 文件,并经 `app-group-store` 原生模块暴露
  给 JS(`claimOutboundShareJobs` / `completeOutboundShareJob` /
  `releaseOutboundShareJob`)。
- **主应用续传**:`OutboundShareHandoffManager.resume()`(JS,
  `src/features/transfer/internal/outboundShareHandoffManager.ts`)认领 pending
  job 并发送——但目前只服务于 iOS 大文件回退场景,且自动发送到扩展内预选的
  `targetDeviceIds`。
- **主应用深链**:已注册 URL scheme `uniclipboard`(`app.json`),并有
  `navigationRef` / `navigateWhenReady` / `flushPendingNavigation`
  (`src/navigation/navigationRef.ts`)支持导航器未就绪时的冷启动导航。
- **Android intent 接收**:`expo-sharing` 已配置
  (`app.json`:`["expo-sharing", {"android": {"enabled": true, "singleShareMimeTypes": ["*/*"]}}]`),
  `useIncomingShare` / `getSharedPayloads` 提供解析后的 payload。

---

## 2. 问题陈述

分享不应是扩展或系统 intent 直连的端到端动作,而应是"暂存 + 主应用内确认"的
统一流程:两端都只做一件事——把收到的内容(文本/图片/文件)暂存到本地队列,
唤醒/回到主应用,由同一个 RN 分享页完成内容预览、接收设备选择(带实时连接状态)
与发送。iOS 借此移除扩展的全部自定义 UI 与扩展内 P2P 会话;Android 借此获得
预览、设备选择与结果可见性,并消除与 iOS 的体验分裂。

---

## 3. 目标

- G1. iOS 与 Android 共用同一套分享流程:接收端只负责暂存,发送统一在主应用
  分享页完成。
- G2. 移除 iOS 分享扩展的自定义 UI(`ShareRootView.swift` 及
  `ShareViewController.swift` 中的 SwiftUI 承载)。
- G3. Android 分享不再自动群发并立即返回,改为进入同一分享页;用户看到内容
  预览、选择接收设备(每台设备显示实时连接状态)后手动发送。
- G4. 统一的内容暂存队列(跨平台 "pending share store"):iOS 复用 App Group
  `outbound-handoff`,Android 在应用私有目录实现相同语义;JS 侧一套 API。
- G5. 发送复用主应用既有链路(`UnifiedContentService` + 历史落库 +
  job 生命周期 claim/complete/release),接收端不启动任何引擎会话。
- G6. iOS 扩展暂存完成后自动唤醒主应用(`uniclipboard://share` 深链),主应用
  无法被唤醒时优雅降级(job 保持 pending,下次启动时呈现)。
- G7. 分享诊断跨"接收端暂存 + 应用内发送"两阶段持续记录。

## 4. 非目标

- 不改动 P2P 协议、`UcEngineCore`、投递协调器或历史格式。
- 不改变 Android 文本选中菜单(`ProcessTextScreen`)与快捷上传
  (`QuickActionApp`)流程。
- 不在接收端(扩展/Intent 直通)构建任何分享产品界面。
- 不支持多内容分享(两端激活规则本就限制每类最多一项)。
- 不改动键盘扩展自身的同步行为。

---

## 5. 目标架构

```text
改造前:

  iOS  分享面板 ─▶ 扩展 ShareRootView(设备选择+发送) ─▶ UcEngineCore 会话
  Android 分享 intent ─▶ ShareReceiveScreen(自动落库+自动群发+立即返回)

改造后(双端统一):

  iOS  分享面板 ─▶ 哑扩展:提取 → 暂存 App Group → completeRequest → openURL 唤醒
  Android 分享 intent ─▶ 哑接收:解析 → 暂存本地队列 → 主 Activity 前台化
                                       │
                                       ▼
                        主应用统一入口(iOS 深链 / Android intent 事件)
                                       │
                                       ▼
                  ShareSendScreen(同一 RN 分享页,平台分文件)
                    ├─ 内容预览(文本 / 图片 / 文件)
                    ├─ 设备列表(useUnifiedSpaceStore,实时在线/离线)
                    └─ 发送:UnifiedContentService + 历史落库
                       └─ claim / completeJob / releaseJob
```

## 6. 需求

### 6.1 统一暂存队列(pending share store)

- R1. 定义跨平台统一接口(JS 层,如 `PendingShareStore`):
  - `claimPending(): PendingShareJob[]` —— 认领全部 pending job;
  - `completeJob(id) / releaseJob(id)` —— 成功清除 / 失败放回;
  - `stagePayload(sourceUri, meta)` —— 把内容写入持久 payload。
    iOS 实现委托 `app-group-store` 原生模块(既有 `OutboundShareStore`,
    App Group 目录布局不变);Android 实现使用 `expo-file-system`,在应用文档
    目录下建立同语义目录结构(`pending-share/files|pending|processing`),
    不引入新原生模块。
- R2. Job 模型统一(原生 `OutboundShareJob` 与 JS `OutboundShareJobDTO`
  同步扩展):新增 `kind` 字段(`'text'` | `'image'` | `'file'`,缺失默认
  `'file'`,保证 iOS 旧版 job 兼容);`targetDeviceIds` 降级为可选元数据——
  接收端不再预选设备,主应用不得依据它自动发送(见 R9)。
- R3. 保留既有 claim/release/complete 语义与 7 天过期;job 在应用被杀后依然
  存在,下次启动可认领;同一 job 只被认领一次(单次认领守卫)。

### 6.2 iOS 扩展侧(`targets/share/`)

- R4. 扩展不再呈现任何自定义 UI。移除 `ShareRootView.swift`、
  `ShareUploader.swift`、`RecipientLoadErrorPresentation.swift` 及分享目标内
  所有 P2P 相关代码(`ExtensionP2pClient`、`ExtensionSyncExecutor`、
  `ExtensionSyncRouter` 在分享目标中的使用)。
- R5. `ShareViewController.viewDidLoad` 在主线程之外异步启动提取/暂存流水线,
  payload 在 App Group 中持久落盘后立即调用 `completeRequest`。暂存期间分享
  面板显示系统自带的转圈(不需要应用提供的视图;仅当面板渲染为空白时才可接受
  一个极简的兜底 `UIViewController`)。
- R6. `completeRequest` 之后,扩展通过 `extensionContext.openURL` 打开
  `uniclipboard://share` 唤醒主应用。打开 URL 失败不得导致暂存或 job 失败——
  job 保持 pending,下次主应用启动时呈现(见 R8/R9)。
- R7. 暂存内容携带完整元数据:kind、显示名、字节数、MIME 类型、payload URI。
  文本以 UTF-8 payload 文件暂存;图片复用 `stageData`;文件复用 `stageFile`
  (既有流式拷贝、`protectFile`,沿用 App Group 目录布局——不新建缓存布局,
  遵守 iOS 存储兼容性约束)。移除范围还包括 `ExtensionLocalization` 中分享
  专用文案,以及相关 Swift 行为检查
  (`scripts/share-recipient-load-presentation-tests.swift` 及
  `check-share-recipient-load-presentation.sh`)和依赖源码文字的 Jest 检查
  (`iosShareProgress.test.ts`、`iosShareLargeFileHandoff.test.ts`)。

### 6.3 Android 接收侧

- R8. 分享 intent 到达后(`useIncomingShare` / `getSharedPayloads`),主应用
  将解析结果**转存**为统一 pending job:文本写 UTF-8 payload 文件,图片/文件
  复制 payload 文件并携带原文件名与 MIME;随后打开分享页。
  转存必须幂等(重复 intent 不重复入队),且只读取一次 intent 数据。
- R9. 移除 `ShareReceiveScreen` 的"自动落库 + 自动群发 + `moveTaskToBack`"
  行为(该组件及其时序回归测试
  `src/__tests__/ShareReceiveScreen.timing.test.tsx` 一并删除或改造);
  Android 分享后停留在主应用的分享页,由用户确认后发送。
- R10. Android 无需深链唤醒(系统 intent 直接启动/前台化主 Activity):
  冷启动走主 Activity intent 数据,热启动走 `Linking` URL 事件
  (沿用 `App.tsx` 既有 `shareReceiveOverlay` 的触发点,改为进入分享页)。

### 6.4 主应用:统一入口与导航

- R11. 新增路由(如 `Share`),挂载同一 `ShareSendScreen`,两端共用;触发入口:
  - iOS:深链 `uniclipboard://share`,同时处理冷启动(`getInitialURL`)与热启动
    (`Linking.addEventListener`),复用 `navigationRef` / `navigateWhenReady` /
    `flushPendingNavigation`,保证导航器未挂载时也能打开;
  - Android:intent 暂存完成后的应用内跳转(与 R10 的 URL 事件共用同一入口)。
- R12. 打开分享页时认领全部 pending job(`claimPending()`)并呈现,不自动发送
  任何 job。`OutboundShareHandoffManager.resume()` 原有的自动发送行为移除,
  替换为页面内由用户触发的发送。

### 6.5 分享页(`ShareSendScreen`)

- R13. 按项目约定平台拆分(`ShareSendScreen.{ios,android,types}.tsx`):
  页面结构、内容预览、设备列表、发送逻辑共享;平台差异只落在组件实现层
  (iOS 用 SwiftUI 控件/Glass 风格,Android 用 M3/Compose 风格,遵循既有
  `HomeTopBar` 等平台分文件模式)。
- R14. 内容预览按 kind 渲染每个暂存 job:
  - 文本:前 N 行 + "…"溢出省略;
  - 图片:由 payload URI 生成缩略图,附格式/大小元数据;
  - 文件:图标、显示名、MIME 类型、字节数。
    多个排队 job 以内容卡片列表呈现。
- R15. 设备列表渲染 `useUnifiedSpaceStore` 的设备(设备名、在线/离线状态,
  "本机"行禁用或隐藏),支持多选,页面挂载时刷新空间快照
  (`getUnifiedSpaceService().refreshDevices()`);未选择任何设备时发送禁用。
- R16. 发送:文本走 `importTextToHistory` + `UnifiedContentService.sendImportedText`;
  图片/文件走 `importFileToHistory` + `sendImportedAsset`,携带用户选择的
  `targetDeviceIds`。投递成功(`delivered`/`partial`,按 `P2pDeliveryState`)后
  `completeJob`;用户取消或失败时按界面明确选择 `releaseJob`(保持 pending
  供稍后重试)或直接丢弃。
- R17. 页面展示每个 job 的发送状态与最终结果;成功后返回 Home。页面须可重入
  且幂等(处理中的 job 再次打开应用不会被重复认领)。

### 6.6 清理与诊断

- R18. JS 侧 `OutboundShareHandoffManager` 保留 claim/complete/release,移除
  自动发送;其测试更新为新语义。
- R19. 诊断持续记录完整旅程(接收端暂存 → 应用内发送 → 成功/失败),两端同一
  数据形态,不新增隐私敏感字段。

---

## 7. 向后兼容

- C1. iOS 旧版本扩展入队的 job(`targetDeviceIds != nil`、无 `kind` 字段)仍可
  认领,按 `kind = 'file'` 渲染并交给用户手动发送,不再自动发送。
- C2. iOS App Group 目录布局(`outbound-handoff/files|pending|processing`)不变,
  无需迁移;Android 新队列目录仅存于应用私有目录,不共享、无迁移。
- C3. iOS 主应用无法被唤醒时(URL 打开失败、应用被卸载),job 保持 pending,
  下次成功启动时呈现;过期机制仍然生效。
- C4. Android 旧版本安装包内由 `expo-sharing` 缓存、尚未消费的分享 payload
  按新流程转存处理,不做特殊迁移。

---

## 8. 验收标准

- AC1. iOS 从任意来源应用分享文本、图片、文件:分享面板迅速关闭(全程不出现
  扩展自定义 UI),主应用自动打开到分享页,分别显示正确的文本/图片/文件预览。
- AC2. Android 从相册/浏览器/文件应用分享文本、图片、文件:主应用进入同一
  分享页并正确预览,不再自动发送、不再自动退回来源应用。
- AC3. 分享页列出空间内全部设备(双端一致),在线/离线状态实时;"本机"不可选;
  多选可用;刷新空间后状态更新且不重载页面。
- AC4. 双端向可达设备发送文本、图片、文件均成功投递;历史中出现对应条目;
  暂存队列被清除(pending/processing 为空,payload 文件删除)。
- AC5. 未选择任何设备时发送禁用;取消后 job 仍可认领——重新打开分享页依然
  可见(除非用户显式丢弃)。
- AC6. iOS 冷启动深链:应用完全终止时分享 → 应用直接启动进入分享页;
  热启动深链:应用在后台 → 分享页叠加打开。iOS 主应用启动失败时分享,仍留下
  可认领的 job,下次打开应用时出现。
- AC7. `targets/share/` 中不再存在 `ShareRootView`、`ShareUploader`、
  `ExtensionP2pClient`、`RecipientLoadErrorPresentation`;分享目标在无
  `UcEngineCore` 依赖的情况下可构建。Android 侧 `ShareReceiveScreen` 不再
  存在自动群发/自动返回行为。
- AC8. 诊断归档显示同一次尝试的"接收端暂存 + 发送"两阶段记录,双端数据形态
  一致。
- AC9. 全量质量门禁通过:Jest(更新后)、`check:quality`、更新后的 Swift 分享
  行为检查、Xcode 27 模拟器构建、Android 构建。

---

## 9. 开放问题

- Q1. iOS `openURL` 与 `completeRequest` 的顺序及可靠性:确认可靠序列
  (先 `openURL` 再 `completeRequest`),以及当前 iOS 版本上 `completeRequest`
  后是否需要短暂延迟。
- Q2. iOS 暂存大文件期间,扩展是否应展示任何最小进度状态(仅系统转圈),还是
  空白面板即可接受?
- Q3. 丢弃 UX:"取消"的处理按平台收敛(见 spec §8.6)——iOS 扩展先写主页历史
  再入队,"取消"即出队(`completeJob`),每次分享页都是崭新的一次分享,未发送
  内容仍留在主页历史;Android 内容仅存在于队列,"取消"保持 `releaseJob`
  (保留 pending,另设显式"删除"操作)。
- Q4. iOS 深链保持无参数 `uniclipboard://share`,还是把 job id 带进 URL,
  以便存在多个 job 时页面认领指定的一项?
- Q5. Android 分享页的返回语义:用户在分享页放弃后是留在主应用 Home 还是
  返回来源应用(`moveTaskToBack`)?建议保留在主应用(与 iOS 一致)。
- Q6. Android 转存时机:解析完成的瞬间即转存,还是进分享页时再转存
  (影响 intent 数据在进程被杀后的存活)?建议前者。
