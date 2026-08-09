# Spec — 双端统一分享流程(哑扩展/哑接收 + 应用内分享页)

状态:待评审
关联文档:`docs/prd/unified-share-flow.md`(本 spec 的实现依据)
基线行为:分享接收端(扩展 / intent)不再直连发送;发送统一在主应用分享页完成。

---

## 1. 术语

| 术语              | 含义                                                            |
| ----------------- | --------------------------------------------------------------- |
| 接收端            | iOS 分享扩展 / Android 分享 intent 接收器,只负责「提取 + 暂存」 |
| PendingShareStore | 跨平台暂存队列抽象(claim/complete/release/stage)                |
| Job               | 队列中一条待发送分享,含内容元数据与 payload 文件引用            |
| 分享页            | 主应用内 RN 页面 `ShareSendScreen`,预览内容 + 选设备 + 发送     |
| Payload           | job 对应的内容文件(文本为 UTF-8 文件,图片/文件为原始字节)       |

---

## 2. 架构总览

```text
iOS:
  分享面板 ─▶ ShareViewController(无 UI)
              ├─ ShareItemExtractor 提取内容
              ├─ OutboundShareStore.stage* + enqueue(App Group,现有目录)
              ├─ completeRequest(面板关闭)
              └─ openURL("uniclipboard://share")
                         │
Android:
  ACTION_SEND intent ─▶ expo-sharing 解析(现有)
              ├─ 转存:PendingShareStore.stage + enqueue(应用私有目录)
              └─ 应用内导航到分享页
                         │
                         ▼
              主应用入口(App.tsx / AppNavigator)
                         │  claimPending()
                         ▼
              ShareSendScreen(双端同一 RN 页面)
               ├─ 内容预览(文本/图片/文件卡片)
               ├─ 设备列表(useUnifiedSpaceStore,实时在线状态)
               └─ 发送 → UnifiedContentService + 历史落库
                    → completeJob / releaseJob / 丢弃
```

核心不变量:接收端**不启动引擎会话、不展示产品界面、不发送**;所有发送路径
只存在一个:分享页 → `UnifiedContentService`。

---

## 3. Job 模型与目录布局

### 3.1 Job 字段(原生 `OutboundShareJob` 与 JS `OutboundShareJobDTO` 同步扩展)

```swift
struct OutboundShareJob: Codable, Equatable, Sendable {
    let id: String
    let kind: JobKind            // 新增;JSON 缺失时解码为 .file(兼容旧版)
    let displayName: String
    let byteCount: Int64
    let mimeType: String?
    let targetDeviceIds: [String]?   // 降级为元数据;主应用不得据此自动发送
    let createdAtMs: Int64
}

enum JobKind: String, Codable { case text, image, file }
```

JS 侧对应 `OutboundShareJobDTO` 增加 `kind: 'text' | 'image' | 'file'`(解码时
缺失默认 `'file'`)。

### 3.2 Payload 文件约定

| kind  | payload 内容                     | displayName 约定                                                                       |
| ----- | -------------------------------- | -------------------------------------------------------------------------------------- |
| text  | UTF-8 编码的文本内容             | 分享来源名缺失时用「分享的文本.txt」;RN 侧以 `kind==='text'` 分支读取内容,不走文件落库 |
| image | 原始图片字节(stageData)          | 原名 + 扩展名                                                                          |
| file  | 原始文件字节(stageFile 流式拷贝) | 原名                                                                                   |

### 3.3 目录布局

**iOS(不变,复用现有)** — App Group 容器下:

```text
<container>/outbound-handoff/
  files/{id}.payload        # payload 文件(staging → payload 原子 move)
  pending/{id}.json         # 待认领 job
  processing/{id}.json      # 已认领 job(15 分钟租约,超时回收)
```

保留 `OutboundShareStore` 全部既有语义:`stageFile` / `stageData` / `enqueue` /
`claimPendingJobs` / `releaseJob` / `completeJob` / `discardStagedFile` /
`removeExpiredJobs`(7 天过期)/ `recoverAbandonedProcessingJobs`。

**Android(新增)** — 应用文档目录下,同语义镜像:

```text
<documentDirectory>/pending-share/
  files/{id}.payload
  pending/{id}.json
  processing/{id}.json
```

不引入新原生模块,用 `expo-file-system`(新 `File` API)实现;JSON 编码格式与
iOS 的 `OutboundShareJob` 字段一致(Android 侧无 App Group,此目录纯私有)。

---

## 4. PendingShareStore(JS 抽象)

新增 `src/features/transfer/internal/pendingShareStore.ts`,统一两端接口:

```ts
export interface PendingShareJob {
  id: string;
  kind: 'text' | 'image' | 'file';
  displayName: string;
  byteCount: number;
  mimeType: string | null;
  fileUri: string; // payload 文件 URI
  createdAtMs: number;
}

export interface PendingShareStore {
  claimPending(): Promise<PendingShareJob[]>;
  completeJob(id: string): Promise<void>;
  releaseJob(id: string): Promise<void>;
  stageText(text: string): Promise<PendingShareJob>; // Android 转存用
  stageAsset(uri: string, displayName: string, mimeType: string | null): Promise<PendingShareJob>; // Android 转存用
  cleanup(): Promise<void>; // 过期清理,启动时调用
  contentPersistedOnStage: boolean; // staging 侧是否已把内容写入主页历史后再入队
  // (iOS=true:扩展先写历史再 enqueue,可安全出队;
  //  Android=false:内容仅存在于队列,取消须保留)
}
```

- iOS 实现 `IosPendingShareStore`:委托 `app-group-store` 的
  `claimOutboundShareJobs` / `completeOutboundShareJob` / `releaseOutboundShareJob`;
  `stageText` / `stageAsset` 在 iOS 由扩展侧完成,JS 侧实现为不可用
  (Android 专用,注释说明)。
- Android 实现 `AndroidPendingShareStore`:基于 `expo-file-system` 按 §3.3 布局
  读写(原子写:先写 `{id}.tmp` 再 `move`),claim 时把 `pending/{id}.json` 移入
  `processing/`,与 iOS 原生实现语义逐条对齐(含租约与过期)。
- 两实现经统一工厂按 `Platform.OS` 选择,`OutboundShareHandoffManager`
  改为注入 `PendingShareStore` 接口(见 §8)。

---

## 5. iOS 哑扩展改造(`targets/share/`)

### 5.1 `ShareViewController` 新逻辑

`viewDidLoad` 中不再挂载 SwiftUI:

```swift
final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        SentryBootstrap.start()   // 保留,记录暂存阶段失败
        let context = extensionContext
        Task.detached {           // 不在主线程
            do {
                let item = try await ShareItemExtractor.extract(from: context)
                let staged = try OutboundShareStore().stage(item)   // 按 kind 分派
                _ = try OutboundShareStore().enqueue(staged)        // targetDeviceIds 恒为空
                ShareDiagnostics.record(staged)
                try await MainActor.run { Self.openMainApp(context) }
            } catch {
                ShareDiagnostics.record(failure: error)
            }
            context?.completeRequest(returningItems: nil, completionHandler: nil)
        }
    }

    static func openMainApp(_ context: NSExtensionContext) {
        let url = URL(string: "uniclipboard://share")!
        context.open(url) { _ in }    // 先 openURL,再 completeRequest
    }
}
```

要点:

- **顺序固定**:`openURL` 之后才 `completeRequest`;`openURL` 失败(回调 `success == false`)
  不改变任何状态,payload 已落盘,job 保持 pending。
- `stage(item)` 按 kind 分派:`text` → 写 UTF-8 payload 文件
  (`displayName = "分享的文本.txt"`,mime `text/plain`);`image` → `stageData`;`file` → `stageFile`。
- 扩展内不触碰 `targetDeviceIds`(无设备选择,enqueue 时传空)。
- `ExtensionSyncRouter`、`ExtensionP2pClient`、`ShareUploader` 等 P2P 代码全部
  删除;`ShareItem` / `ShareItemExtractor` 保留复用。

### 5.2 删除清单

| 文件                                                    | 处理                                                                                                           |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `targets/share/ShareRootView.swift`                     | 删除                                                                                                           |
| `targets/share/ShareUploader.swift`                     | 删除                                                                                                           |
| `targets/share/RecipientLoadErrorPresentation.swift`    | 删除                                                                                                           |
| `targets/share/SentryBootstrap.swift`                   | 保留                                                                                                           |
| `targets/share/ShareItem.swift`                         | 保留(提取逻辑),按 §3.1 扩展 kind                                                                               |
| `targets/share/OutboundShareHandoff.swift`              | 保留,`OutboundShareJob` 加 `kind`;`shouldSendDirectly` / `OutboundShareFallbackPolicy` 删除                    |
| `scripts/share-recipient-load-presentation-tests.swift` | 删除                                                                                                           |
| `scripts/check-share-recipient-load-presentation.sh`    | 删除                                                                                                           |
| `src/__tests__/iosShareProgress.test.ts`                | 重写为「扩展哑化」约束(无 SwiftUI、无 P2P、含 openURL)                                                         |
| `src/__tests__/iosShareLargeFileHandoff.test.ts`        | 重写为「大文件全量走暂存」                                                                                     |
| `targets/share/Info.plist`                              | 激活规则不变;`NSExtensionPrincipalClass` 保留                                                                  |
| `targets/share/ExtensionLocalization.swift`             | 删除分享 UI 文案,保留错误文案(提取失败提示不再需要,可整文件删除并同步 `ShareItemError` 移除 `message(using:)`) |

诊断:扩展内记录 `attemptStarted`、`staged`(新增 stage)、`stagedFailed`;发送阶段
由主应用在分享页发送时续写同一 attempt(经 `app-group-store` 的
`ShareDiagnosticsStore`,现有能力)。

---

## 6. Android 哑接收改造

### 6.1 现状

`App.tsx`:`expo-sharing` 的 intent URL(`expo-sharing://…`)触发
`shareReceiveOverlay` → 渲染 `ShareReceiveScreen`(解析 → 落库 → 自动群发 →
`moveTaskToBack`)。payload 由 `useIncomingShare` / `getSharedPayloads` 提供
(字段:`value`、`shareType`、`contentUri`、`contentMimeType`、`originalName`、
`contentSize`)。

### 6.2 新逻辑

新增 `src/screens/ShareReceiveRedirector.tsx`(或改造 `ShareReceiveScreen`):

1. 挂载后等待 `useIncomingShare` 解析完成(保留现有「isResolving 首帧为 false」
   的时序守卫:`resolveError != null || resolvedSharedPayloads.length > 0 ||
resolveStartedRef.current`)。
2. 对每个 resolved payload **立即转存**(解析完成即转存,进程被杀不丢):
   - `shareType === 'text'` 或 `contentUri == null`:文本 → `store.stageText(value)`;
   - 否则 → `store.stageAsset(contentUri, originalName ?? fallback, contentMimeType)`,
     图片由 `contentMimeType` 前缀 `image/` 判定 `kind='image'`。
3. `clearSharedPayloads()` 后调用 `navigateWhenReady('Share')` 进入分享页,
   并卸载 redirector(不再自动发送、不再 `moveTaskToBack`)。
4. 转存失败:保留现有 toast 提示,仍导航到分享页(空队列页显示"暂无待发送内容")。

删除 `src/screens/ShareReceiveScreen.tsx` 的自动发送/返回逻辑及
`src/__tests__/ShareReceiveScreen.timing.test.tsx`(以 redirector 的时序测试替代)。

`App.tsx`:`shareReceiveOverlay` 改为渲染 `ShareReceiveRedirector`
(`onComplete` 不再需要 `returnToSource` / `moveTaskToBack`)。

---

## 7. 主应用统一入口与导航

### 7.1 路由

`AppNavigator.tsx` 的 `RootStackParamList` 新增:

```ts
type RootStackParamList = {
  // ...现有
  Share: undefined; // 分享页(modal 呈现,双端一致)
};
```

`Share` 屏用 `presentation: 'modal'`(iOS)/`card` 滑动(Android),header 隐藏,
页面自带关闭按钮(取消 = 返回 Home)。

### 7.2 入口接线

| 场景           | 触发                                                   | 动作                                                         |
| -------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| iOS 冷启动     | `Linking.getInitialURL()` === `uniclipboard://share`   | `navigateWhenReady('Share')`                                 |
| iOS 热启动     | `Linking.addEventListener('url')` 同 URL               | `navigateWhenReady('Share')`                                 |
| Android 冷启动 | 主 Activity intent 数据(`expo-sharing` 已缓存 payload) | `ShareReceiveRedirector` 转存后 `navigateWhenReady('Share')` |
| Android 热启动 | `isShareIntentUrl(url)`(现有判断)                      | 同上一行                                                     |

`navigateWhenReady` / `flushPendingNavigation`(`src/navigation/navigationRef.ts`)
复用现状,无需改动。

### 7.3 认领守卫

分享页挂载时执行 `claimPending()`;**单次认领守卫**:页面内部
`claimedRef` + 处理器级 `running` 锁(复用 `OutboundShareHandoffManager` 现有
`this.running` 模式),避免双开页面/重复 intent 重复认领。认领失败(如并发
写入)保持页面空态并提示"稍后重试"。

---

## 8. 分享页 `ShareSendScreen` 规格

### 8.1 文件结构(遵循平台分文件约定)

```text
src/screens/share/
  ShareSendScreen.tsx            → export * from './ShareSendScreen.android'
  ShareSendScreen.types.ts       → Props 与共享类型
  ShareSendScreen.android.tsx    → M3 / Compose 风格
  ShareSendScreen.ios.tsx        → SwiftUI 控件 / Glass 风格
  useShareSendController.ts      → 状态机与逻辑(双端共用)
```

### 8.2 页面状态机(useShareSendController)

```ts
type Phase =
  | { kind: 'claiming' } // 认领中
  | { kind: 'ready'; jobs: ShareJobView[] } // 展示与选择
  | { kind: 'sending'; jobId: string; stage: SendStage } // 发送中
  | { kind: 'done'; results: SendResult[] } // 全部结束
  | { kind: 'error'; message: string };
```

`ShareJobView` = `PendingShareJob` + 预览派生数据(文本前 80 字 / 图片缩略图 URI /
文件图标行)。

### 8.3 内容预览

| kind  | 渲染                                                                      |
| ----- | ------------------------------------------------------------------------- |
| text  | 文本前 N 行(≤80 字)+ "…";payload 内容经 `File(fileUri).text()` 读取       |
| image | `Image` 组件加载 `fileUri` 缩略图(64–96pt),附 `displayName` / `byteCount` |
| file  | 图标 + `displayName` + `mimeType` + `byteCount`(`formatBytes`)            |

### 8.4 设备列表

- 数据源:`useUnifiedSpaceStore`(设备名、`online`、`isLocal`)。
- 挂载时 `getUnifiedSpaceService().refreshDevices()` 刷新一次;刷新失败沿用
  现有快照(状态仍显示,不做失败阻断)。
- 行渲染:`isLocal` 置灰禁用或隐藏;在线绿色圆点 + "在线",离线灰点 + "离线"
  (文案沿用 `space.devices.online/offline` 现有 i18n key)。
- 多选:`Set<deviceId>`;为空时发送按钮禁用。
- 平台差异只落在组件层(iOS `@expo/ui/swift-ui` + `lucide-react-native`,
  Android Compose + Ionicons),逻辑全在 controller。

### 8.5 发送流程(每个 job)

```text
选中设备 → 发送
  ├─ kind=text   → importTextToHistory(text) → sendImportedText(text, profileHash)
  ├─ kind=image  → importFileToHistory(fileUri, displayName, mime, byteCount)
  │                 → sendImportedAsset({kind:'image', uri, fileName, mimeType},
  │                                     profileHash, { targetDeviceIds })
  └─ kind=file   → importFileToHistory(..., { skipInitialCopyOnIOS: true })
                    → sendImportedAsset({kind:'file', uri: 历史落库后的 fileUri, ...},
                                        profileHash, { targetDeviceIds })

投递状态(deliveryState):
  delivered / partial → completeJob(id) → 标记成功
  offline / failed / pending → 标记失败,保留 releaseJob 选项
```

- 发送按 job 顺序串行,每项独立展示状态(进行中/成功/失败)。
- 失败时该 job 不自动重试;界面提供「重试」与「删除」(丢弃=`completeJob` 后
  连同 payload 清除;「删除」= `discardStagedFile` 语义,见 §8.6)。
- 发送结束后停留在页面直到用户点「完成」返回 Home(不自动 dismiss)。

### 8.6 取消 / 丢弃语义(收敛 PRD Q3)

| 操作       | 语义                                                                                                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 取消(返回) | 按 staging 侧是否已入历史处置:iOS 扩展已把内容写入主页历史,未发送 job 直接 `completeJob` 出队,保证每次分享页都是崭新的一次分享;Android 内容仅存在于队列,`releaseJob` 保持 pending,下次打开分享页重新认领 |
| 重试       | 同一 job 重新走发送流程(无需重新认领)                                                                                                                                                                    |
| 删除(显式) | `completeJob(id)` 清除记录 + payload 文件(不可恢复,二次确认)                                                                                                                                             |
| 发送成功   | `completeJob(id)` 清除                                                                                                                                                                                   |

- iOS「取消即出队」安全的前提:扩展先写主页历史再 enqueue(§5.1),有 job 记录
  必有历史,出队不丢内容。
- 认领时的陈旧清理:认领后,超过处理租约(15 分钟)的 job 只可能是中断会话的
  残留(iOS 内容已在主页历史),直接 `completeJob`,避免历史未发送内容堆积。

### 8.7 与 `OutboundShareHandoffManager` 的关系

- `OutboundShareHandoffManager.run()` 的自动发送循环删除。
- 保留类骨架与单例守卫,职责改为:提供 `claimPending()` 的并发守卫 + 分享页
  发送完成后的 `completeJob` 封装;依赖注入改为 `PendingShareStore`(§4)。
- `composition.ts` 的 `configureOutboundShareHandoffManager` 改为注入
  `PendingShareStore`(iOS=module 委托,Android=文件实现)。
- 启动时不再自动 resume(替换为分享页触发);`removeExpiredJobs` 清理改到
  主应用启动流程(AppRuntime 或分享页挂载时,双端一致)。

---

## 9. 数据流时序(验收用)

**iOS 分享文件到可达设备**:

```text
来源 app ─▶ ShareViewController ─▶ OutboundShareStore.stageFile(流式拷贝,内存安全)
         ─▶ enqueue(pending/{id}.json) ─▶ openURL("uniclipboard://share")
         ─▶ completeRequest(面板关闭)
主应用(冷/热启动) ─▶ Linking ─▶ navigateWhenReady('Share')
分享页 ─▶ claimPending(→ processing/) ─▶ 预览 + 选设备 ─▶ sendImportedAsset
       ─▶ delivered ─▶ completeJob(→ 全部清除)
```

**Android 分享文本**:

```text
来源 app ─▶ ACTION_SEND ─▶ expo-sharing 解析 ─▶ ShareReceiveRedirector
         ─▶ stageText(UTF-8 payload + pending json) ─▶ clearSharedPayloads
         ─▶ navigateWhenReady('Share') ─▶ (后续同上)
```

**iOS 主应用无法唤醒**:job 留在 `pending/`,7 天内任意一次打开主应用进入分享页
时被认领。

---

## 10. 兼容性

- C1. 旧版 iOS 扩展入队的 job:JSON 无 `kind` → 解码为 `.file`;`targetDeviceIds`
  非空仅作为展示用元数据,不自动发送。
- C2. App Group 目录布局不变,无迁移。
- C3. 旧版 Android 安装包残留的 `expo-sharing` 缓存 payload:进入 redirector 后
  按 §6.2 转存(消费一次,`clearSharedPayloads`)。
- C4. `ShareReceiveScreen` 导出从 `src/screens/index.ts` 移除,若发布窗口内
  有外部引用一并收敛(仓库内无外部引用)。

---

## 11. 测试计划

### 11.1 自动化

| 测试                                     | 内容                                                                                                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pendingShareStore.android.test.ts`      | 新:staging 原子写、claim 移入 processing、release/complete、7 天过期、租约回收(文件系统行为)                                                                            |
| `ShareSendController.test.ts`            | 新:状态机推进、空设备禁用、发送成功 →complete、失败 → 保留、删除 → 清除;关闭语义按 `contentPersistedOnStage` 分流(iOS 出队 / Android 保留);认领时陈旧 job(>15 分钟)出队 |
| `ShareReceiveRedirector.test.ts`         | 新:解析时序守卫、文本/图片/文件转存、幂等(重复 intent)                                                                                                                  |
| `iosShareProgress.test.ts`(重写)         | 哑扩展约束:无 SwiftUI 视图、无 `ExtensionSyncRouter`/`ExtensionP2pClient` 引用、`openURL` 在 `completeRequest` 前、`kind` 字段                                          |
| `iosShareLargeFileHandoff.test.ts`(重写) | 大文件全量走 `stageFile` 暂存;`shouldSendDirectly` / fallback 已删除                                                                                                    |
| Swift 行为检查                           | 扩展提取+暂存+complete 的行为测试(替代已删除的 recipient-load-presentation 检查)                                                                                        |
| 现有 Jest 全量                           | 更新受 `kind`/DTO 变化影响的用例                                                                                                                                        |

### 11.2 真机验收

iOS:

1. 文本/图片/文件分享 → 面板立即关闭,主应用进分享页,预览正确。
2. 冷启动深链(杀进程后分享)、热启动深链(后台分享)。
3. 分享 >100MB 文件,内存平稳(流式拷贝),进分享页后发送成功。
4. 主应用被卸载/URL 失败场景:job 保留,下次打开出现。
5. iOS 分享页取消 → 未发送 job 出队(内容仍在主页历史),重开分享页为崭新状态;Android 取消 → 重开仍见。删除 → 不再出现。

Android:

6. 相册图片、文件管理器文件、浏览器文本分享 → 进分享页,预览正确,不再自动
   返回来源应用。
7. 分享页选设备发送成功;历史出现条目;`pending-share/` 目录清空。
8. 双开(重复分享 intent)不产生重复 job。

双端:

9. 设备列表实时状态与空间页一致;本机不可选;未选设备发送禁用。

---

## 12. 实施顺序

| 阶段 | 内容                                                                                            | 完成标志                            |
| ---- | ----------------------------------------------------------------------------------------------- | ----------------------------------- |
| A    | Job 模型加 `kind`(Swift + DTO + 解码兼容);JS `PendingShareStore` 抽象 + Android 实现 + iOS 委托 | 新接口带测试,现有行为不变           |
| B    | Android 哑接收:redirector 替换自动发送;分享页可打开空态                                         | Android 分享进入分享页,不再自动发送 |
| C    | iOS 哑扩展:ShareViewController 重写、删除 SwiftUI/P2P、openURL 接线                             | 分享 → 主应用自动打开分享页         |
| D    | 分享页完整实现(预览/设备/发送/取消/删除),`OutboundShareHandoffManager` 改造                     | §8 全部行为可用,AC 全过             |
| E    | 清理:删除遗留文件与旧测试,诊断字段补齐,全量质量门禁 + 真机验收                                  | `check:ci` + 双端真机通过           |

每个阶段保持可编译可运行、可单独提交回退;阶段 A/B 不改变 iOS 现状行为。

---

## 13. 开放问题(进入实现前需确认)

- Q1. iOS `openURL` 在扩展中无 UI 场景的可靠性:若个别 iOS 版本上无 UI 扩展
  的 `openURL` 不生效,退路是保留极简占位 VC 再 open(方案已留兜底,需真机确认)。
- Q2. Android 分享页「完成后返回来源应用」是否完全放弃(`moveTaskToBack` 移除)?
  本 spec 按 PRD Q5 建议:留在主应用。
- Q3. `stageText` 在 iOS 端 JS 侧不可用(由扩展完成),接口是否改为
  `stageText`/`stageAsset` 仅 Android 契约 + 注释说明,还是拆成两个接口?
  本 spec 暂用注释说明方案,进入实现时定。
