# Spec - 打开“我的空间”时先展示已知设备

状态: 待实施

日期: 2026-08-10

关联决策: `docs/adr/001-show-my-space-before-refresh.md`

实现基线: Expo SDK 56、React Native 0.85、`@expo/ui` 56.0.18、Engine
`v1.0.0-rc.6` (`90aff6b071a1466343fd1f301654ea89b5f98ce5`)

---

## 1. 目标

“我的空间”必须先展示当前进程已经知道的设备名单，再按明确事件在后台更新。
查看设备不依赖网络请求完成，更新也不能清空、遮住或重置正在显示的内容。

本规格完成后:

- 冷启动尚未取得名单时，面板显示首次加载，启动恢复完成后原地出现设备。
- 已经取得过名单后，打开和重复打开面板不发起刷新，设备立即可见。
- 设备变化、连接变化、应用回到前台和用户主动刷新会请求最新名单。
- 自动更新保持安静；用户下拉刷新才显示原生刷新进度。
- 更新失败保留最后一次成功名单，并提供可用的重试入口。
- 同一时刻的相同刷新只执行一次，轻量设备刷新不能压掉完整空间恢复。

## 2. 非目标

- 不改变创建空间、加入空间、邀请、移除成员或发送内容的业务规则。
- 不改变首页下拉刷新；首页刷新仍属于内容与连接恢复，不是设备名单刷新。
- 不新增 JS 持久化、页面缓存、数据库表或第二份设备名单。
- 不增加定时刷新、轮询、超时后自动清空或固定时间节流。
- 不重做“我的空间”的整体视觉结构、邀请流程或面板尺寸规则。
- 不改变 `ShareSendSheet` 按其独立规格在打开时刷新设备的行为。
- 不保留旧 Engine 事件的兼容分支，不增加迁移或 fallback。

## 3. 已确认的现状

### 3.1 数据来源

设备名单的持久来源是 Engine。`UnifiedSpaceService` 通过
`querySpaceState()` 和 `listDevices()` 读取后，发布到
`useUnifiedSpaceStore`。Zustand store 没有持久化，也没有另一份名单。

```text
Engine 持久状态
  -> UnifiedSpaceService 内存快照
  -> useUnifiedSpaceStore
  -> useMySpaceSheet
  -> MySpaceSheet.android / MySpaceSheet.ios
```

这个数据流保持不变。

### 3.2 启动时序

`App.tsx` 在设置加载完成后**立即**调用 `AppRuntime.start()`，与首屏历史加载
并行进行，让空间恢复尽早完成；历史维护仍在首屏历史完成后执行，避免冷启动时
争抢本地存储。导航只等待“曾完成空间设置”的本地标记，不等待设备名单。
因此首页可以先出现，用户也可以在完整空间恢复开始或结束前打开“我的空间”。

并行启动后，冷启动打开“我的空间”时名单通常已就绪；尚未就绪时面板消费
“名单尚未取得”的状态显示首次加载，不能自己启动第二轮恢复。

### 3.3 当前缺口

- `useMySpaceSheet` 在每次 `visible=true` 时调用 `refreshDevices()`。
- 同一个 hook 监听通用 `refreshRevision`。剪贴板、传输和内容事件也会触发
  无意义的设备查询。
- 真正的配对完成在固定 Engine 版本中是
  `changed(kind='pairing_completed')`，当前通用 revision 不会因它变化。
- `UnifiedSpaceService` 只用 revision 丢弃旧结果，没有合并在途请求。
- 后开始的 `refreshDevices()` 可以使先开始的完整 `refresh()` 失效，导致旧空间
  继续保留，整体状态还可能停在 `loading`。
- 设备刷新失败只保存在 hook 本地；Android 关闭面板会卸载 hook，iOS 不会，
  两端错误生命周期不同。
- 首次恢复失败时可能同时显示错误和“没有设备”；如果还没有 `spaceId`，当前重试
  甚至不会调用完整恢复。
- iOS 已在回到前台时完整刷新；Android 没有等价行为。
- 正常状态没有用户主动刷新入口。

## 4. 核心不变量

1. `UnifiedSpaceService` 是设备名单、名单可用性和更新结果的唯一所有者。
2. `devices` 在新结果成功发布前保持不变；任何刷新开始或失败都不得清空它。
3. “是否有可展示的已知名单”不能由 `devices.length` 推断。成功得到空数组也是一份
   已知名单。
4. 完整空间恢复优先于设备轻量刷新。设备刷新不得取消、覆盖或阻止完整恢复发布。
5. 创建、加入、切换和离开空间继续使旧刷新结果失效。旧空间结果绝不能重新发布。
6. 页面只订阅统一快照。页面可提出用户刷新请求，但不保存名单、不判断 Engine 事件。
7. 打开、关闭或重新打开“我的空间”不是刷新触发器。
8. 自动更新不显示阻断进度；用户主动刷新使用平台原生刷新进度。
9. 不使用计时器或轮询补偿遗漏事件。

## 5. 统一设备名单状态

### 5.1 快照字段

在现有 `UnifiedSpaceSnapshot` 中增加两个字段，不新增 store:

```ts
export type DeviceListRefreshStatus = 'idle' | 'refreshing' | 'failed';

export interface UnifiedSpaceSnapshot {
  // 现有字段保持
  devices: UnifiedSpaceDevice[];

  // 当前空间是否至少成功执行过一次 listDevices，包括成功返回 []。
  hasResolvedDeviceList: boolean;

  // 最近一轮完整恢复或设备刷新对名单的状态。
  deviceListRefreshStatus: DeviceListRefreshStatus;
}
```

`lastError` 继续保存服务层错误。界面只显示本地化的通用说明，不显示原始错误文本。

### 5.2 状态转换

| 场景                   | `hasResolvedDeviceList` | `deviceListRefreshStatus` | `devices`                 |
| ---------------------- | ----------------------- | ------------------------- | ------------------------- |
| 进程初始状态           | `false`                 | `idle`                    | `[]`                      |
| 完整恢复或设备刷新开始 | 保持                    | `refreshing`              | 保持                      |
| 活跃空间名单成功       | `true`                  | `idle`                    | 替换为完整结果，可为 `[]` |
| 确认当前没有空间       | `false`                 | `idle`                    | 清空                      |
| 刷新失败               | 保持                    | `failed`                  | 保持                      |
| 创建或加入成功         | `true`                  | `idle`                    | 使用操作后取得的完整名单  |
| 移除成员或继续移除成功 | `true`                  | `idle`                    | 使用操作后取得的完整名单  |
| 离开空间成功           | `false`                 | `idle`                    | 清空                      |

规则:

- 完整 `refresh()` 开始时仍可把整体 `status` 设为 `loading`，但不得改变已解析标记
  或已有设备。
- 完整 `refresh()` 失败时，整体 `status='failed'`，名单状态也为 `failed`。
- `refreshDevices()` 失败时，不把整个空间改成 failed，只把名单状态改成 `failed`，
  并保留空间身份和名单。
- `refreshDevices()` 成功且当前仍是同一空间时，名单状态恢复为 `idle`；若整体状态曾
  因旧的完整刷新失败而为 `failed`，成功结果将整体状态恢复为 `ready`。
- 每次开始新请求先清除 `lastError`；失败发布错误，成功保持为 `null`。
- 每次转换只发布一份自洽快照，不能先清空名单再发布第二份结果。

### 5.3 界面派生状态

| 快照                         | 面板显示                                   |
| ---------------------------- | ------------------------------------------ |
| 未解析，状态不是 failed      | 首次加载；不显示“没有设备”                 |
| 未解析，状态为 failed        | 加载失败 + 重试；不显示“没有设备”          |
| 已解析，名单非空，idle       | 设备行                                     |
| 已解析，名单非空，refreshing | 原设备行继续可见可操作；自动更新无阻断提示 |
| 已解析，名单非空，failed     | 原设备行 + 非阻断错误 + 重试               |
| 已解析，名单为空，idle       | “没有设备”                                 |
| 已解析，名单为空，refreshing | 保留“没有设备”；用户下拉时另显示原生进度   |
| 已解析，名单为空，failed     | “没有设备” + 非阻断错误 + 重试             |

“首次加载”“失败”和“已知为空”必须互斥。设备数量不能决定首次加载。

## 6. 刷新触发规则

### 6.1 触发表

| 触发                                | 请求               | 说明                                         |
| ----------------------------------- | ------------------ | -------------------------------------------- |
| 应用正式启动                        | 完整 `refresh()`   | 保留现有启动恢复，不依赖 AppState            |
| 从非 active 回到 active             | 完整 `refresh()`   | iOS、Android 一致；重复触发由请求合并处理    |
| 网络环境变化                        | 完整 `refresh()`   | 保留现有 AppRuntime 路径                     |
| 影响连接策略的设置变化              | 完整 `refresh()`   | 保留现有 AppRuntime 路径                     |
| `refreshRequired`                   | `refreshDevices()` | Engine 明确要求消费者重读状态                |
| `peerPresenceChanged`               | `refreshDevices()` | 更新在线状态                                 |
| `workspaceConvergenceChanged`       | `refreshDevices()` | 更新成员和空间同步状态                       |
| `changed(kind='pairing_completed')` | `refreshDevices()` | 固定 Engine 版本的配对终态；成功后名单会变化 |
| 用户下拉刷新                        | 完整 `refresh()`   | 同时覆盖首次恢复失败和已有空间更新           |
| 用户点击错误行“重试”                | 完整 `refresh()`   | 与下拉刷新共用同一方法                       |
| 创建、加入、移除、离开              | 不另发刷新         | 各操作继续直接发布自己的权威结果             |

### 6.2 明确不触发

- 打开、关闭或重复打开“我的空间”。
- `incomingEntry`、`incomingPending`、接收进度、发送状态、传输进度、
  `activeClipboardChanged` 和 `networkRecoveryChanged`。
- 除 `pairing_completed` 外的普通 `changed` kind。
- Android 窗口 `focus` / `blur`，包括只展开通知栏。
- 定时器、固定间隔、面板停留时长和设备数量变化的前端猜测。

### 6.3 分享页例外

`ShareSendSheet` 仍按 `docs/specs/unified-share-flow.md` 在打开时提出一次设备刷新。
它不是“我的空间”打开行为，不在本 ADR 中删除。服务层的请求合并和优先级同样适用，
所以它不能压掉启动或前台完整恢复。

## 7. AppRuntime 负责事件路由

`AppRuntime` 成为设备更新触发的唯一运行期协调者:

1. 在 Engine 启动前只订阅一次 `UnifiedEngineService.subscribeEvents()`。
2. 用一个纯函数判断事件是否属于第 6.1 节的四种设备事件。
3. 应用为 active 时，对设备事件调用 `UnifiedSpaceService.refreshDevices()`。
4. 应用不是 active 时不启动设备查询；下一次 active 的完整 `refresh()` 会恢复权威状态。
5. 事件回调捕获并记录失败，服务已经把失败状态发布到统一快照。
6. 删除页面对通用 `refreshRevision` 的设备查询。

AppState 订阅改为两端共有:

- 保存前一状态，仅在 `previous !== 'active' && next === 'active'` 时刷新。
- iOS 在 inactive/background 时继续取消前台 peer recovery，现有生命周期行为不变。
- Android 只更新应用状态并处理回到前台，不执行 iOS 专属取消逻辑。
- 初次启动仍由 `start()` 负责，不把初始 active 当作一次额外前台刷新。

页面关闭期间发生的设备事件也会更新统一快照。再次打开时只展示结果，不补发请求。

## 8. 请求合并与优先级

### 8.1 实现位置

请求协调放在现有 `UnifiedSpaceService` 内部，不新增协调模块。增加两个私有在途引用:

```ts
private fullRefreshInFlight: Promise<UnifiedSpaceSnapshot> | null;
private deviceRefreshInFlight: Promise<UnifiedSpaceSnapshot> | null;
```

每个 Promise 在成功和失败后都按身份清除，确保失败后可以真正重试。

### 8.2 并发规则

| 当前在途请求 | 新请求   | 行为                                                       |
| ------------ | -------- | ---------------------------------------------------------- |
| 无           | 完整恢复 | 启动完整恢复                                               |
| 无           | 设备刷新 | 有 `spaceId` 时启动；否则直接返回当前快照                  |
| 完整恢复     | 完整恢复 | 返回同一轮结果，不重复调用 Engine                          |
| 完整恢复     | 设备刷新 | 加入完整恢复，不增加 revision，不调用第二次 `listDevices`  |
| 设备刷新     | 设备刷新 | 返回同一轮结果，不重复调用 Engine                          |
| 设备刷新     | 完整恢复 | 立即启动更强的完整恢复；轻量结果不得发布，完整结果最终生效 |

完整恢复必须在任何 `await` 之前登记为 in-flight，避免同一个事件循环内的设备请求抢先。

### 8.3 与空间变更的竞争

- `createSpace`、`joinSpace`、`leaveSpace` 和成员变更继续递增 mutation revision。
- mutation 开始后，之前的完整或轻量刷新结果都不得发布。
- mutation 成功发布它自己取得的名单；离开成功发布空空间。
- mutation 期间到达的重复设备事件不得改变 mutation 结果。mutation 完成后的新事件可以
  开始新一轮设备刷新。
- 现有“旧刷新不得覆盖新加入或离开”的测试保留，并增加完整恢复与轻量刷新互相竞争的
  两个方向。

### 8.4 不采用固定节流

请求合并只覆盖真实重叠的调用。前一轮已经结束后又收到新的设备事件，必须允许新请求，
因为它可能代表新的状态变化。不得用固定秒数忽略事件。

## 9. Engine 事件基线

### 9.1 实施前检查

本规格撰写时，`npm run core:verify` 失败:

- `core-source.json` 要求的 Swift binding SHA-256 为 `1839ff2c...`。
- 工作区文件实际为 `77ac255d...`。
- iOS 与 Android host 仍引用 rc.6 已删除的 `SharedDeviceRefreshChanged` case。

实施第一步必须执行仓库现有 `npm run core:prepare`，随后要求
`npm run core:verify` 通过。没有通过前，不进行原生构建和真机归因。

### 9.2 事件映射

固定 Engine rc.6 的 sponsor 配对终态会在 binding 层成为
`changed(kind='pairing_completed')`。实现必须:

- 删除 Swift/Kotlin host 中已过时的 `SharedDeviceRefreshChanged` 分支。
- 保留 generic `BindingEvent.Changed -> EngineEvent.changed` 的直接映射。
- 将 `pairing_completed` 纳入 AppRuntime 的设备事件判断。
- 不等待或假设随后一定还会收到 `peerPresenceChanged`。
- 不为旧事件名保留兼容判断。

配对失败也使用同一个终态 kind。此时允许执行一次合并后的设备查询；只有名单真的出现
新 `deviceId` 时，邀请流程才显示配对成功。

## 10. “我的空间”控制器

`useMySpaceSheet` 保留邀请和用户交互逻辑，删除刷新触发策略。

### 10.1 删除

- 删除 `useUnifiedEngineStore.refreshRevision` 订阅。
- 删除 `visible=true` 就调用 `refreshDevices()` 的 effect。
- 删除 hook 本地 `refreshFailed`；失败来自统一快照。
- 删除 `if (!spaceId) return` 的重试短路。

### 10.2 保留和新增

- 继续直接订阅 `devices`，邀请成功仍由新 `deviceId` 出现在统一名单中驱动。
- 从统一快照派生 `isInitialLoading`、`isKnownEmpty` 和 `deviceListFailed`。
- 保留一个 hook 本地 `isUserRefreshing`，只表示用户下拉或点击重试发起的请求。
- 暴露一个 `refresh()`，始终调用完整 `UnifiedSpaceService.refresh()`，返回同一个 Promise
  给原生刷新控件，并在 finally 中结束 `isUserRefreshing`。
- 多次调用由服务层合并；hook 不实现自己的缓存、revision 或计时器。

后台名单更新不能重置以下临时状态:

- 当前邀请码和倒计时。
- 已复制状态。
- 面板 detent/高度。
- 已识别的新设备提示。
- 面板是否打开。

设备行继续使用 `deviceId` 作为 key，新设备、移除设备和在线状态只原地更新列表。

## 11. 双端原生呈现

### 11.1 Android

在 `MySpaceSheet.android.tsx` 中使用已安装的
`@expo/ui/jetpack-compose` `PullToRefreshBox` 包住现有 `LazyColumn`:

- `isRefreshing` 只绑定 `isUserRefreshing`。
- `onRefresh` 调用 controller 的 `refresh()`。
- 自动后台刷新不能使下拉指示器出现。
- 保留现有 Modal、列表高度、设备行、邀请区和 M3 样式。

### 11.2 iOS

在 `MySpaceSheet.ios.tsx` 的现有 SwiftUI `List` modifiers 中加入
`refreshable(refresh)`:

- handler 返回完整刷新 Promise，系统负责在 Promise 结束后收起进度。
- 自动后台刷新不调用该 handler，因此不显示下拉指示器。
- 保留现有 `BottomSheet`、List、detent、邀请区和 Liquid Glass 规则。

### 11.3 错误文案

四种语言的 `settingsSync.json` 增加 `space.devices.refreshFailed`，含义为:

> 无法更新设备，当前显示的是上次结果。

有已知名单时使用这条非阻断说明；从未取得名单时继续使用现有通用操作失败说明。
两种情况都复用公共“重试”文案。不得展示原始 Engine 错误。

## 12. 关键时序

### 12.1 冷启动后立即打开

```text
Home 可见
  -> 用户打开 My Space
  -> store: hasResolvedDeviceList=false
  -> 面板显示首次加载，不发请求
  -> AppRuntime.start 完成 Engine 启动
  -> UnifiedSpaceService.refresh
  -> store 发布完整名单
  -> 面板原地显示设备
```

### 12.2 已有名单时收到设备事件

```text
Engine event(peerPresence/workspaceConvergence/pairing/refreshRequired)
  -> AppRuntime 过滤
  -> UnifiedSpaceService.refreshDevices(single-flight)
  -> 旧设备行继续可见
  -> 成功: 原地发布新名单
     失败: 保留旧名单 + 显示重试
```

### 12.3 用户主动刷新

```text
用户下拉或点重试
  -> isUserRefreshing=true
  -> UnifiedSpaceService.refresh(full, single-flight)
  -> 原生刷新进度显示，旧设备行保留
  -> 成功或失败真正结束
  -> isUserRefreshing=false
```

## 13. 文件影响

| 文件                                                  | 改动                                                        |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| `src/features/space/store.ts`                         | 增加名单已解析标记和名单刷新状态                            |
| `src/features/space/internal/spaceService.ts`         | 统一状态转换、错误发布、请求合并和完整恢复优先级            |
| `src/app/runtime/appRuntime.ts`                       | 两端前台触发、设备事件过滤和统一设备刷新                    |
| `src/app/runtime/composition.ts`                      | 向 AppRuntime 提供 Engine 事件订阅和设备刷新接口            |
| `src/components/useMySpaceSheet.ts`                   | 删除打开/通用 revision 刷新，改为消费统一状态并提供用户刷新 |
| `src/components/MySpaceSheet.android.tsx`             | `PullToRefreshBox` 和互斥状态呈现                           |
| `src/components/MySpaceSheet.ios.tsx`                 | SwiftUI `refreshable` 和互斥状态呈现                        |
| `src/screens/settings/UnifiedSpaceSetup.android.tsx`  | 删除通用 revision 驱动的重复设备刷新                        |
| `src/screens/settings/ios/SpacePage.tsx`              | 删除通用 revision 驱动的重复设备刷新                        |
| `src/components/useAddSyncConnectionFlow.ts`          | 直接观察统一名单确认配对，不因任意 Engine revision 完整刷新 |
| `modules/uc-engine/ios/UcEngineModule.swift`          | 删除过时事件 case，保留 generic changed 映射                |
| `modules/uc-engine/android/.../UcEngineModule.kt`     | 删除过时事件 case，保留 generic changed 映射                |
| `src/i18n/locales/{en,pt-BR,ru,zh}/settingsSync.json` | 增加已知名单更新失败文案                                    |
| 相关测试                                              | 按第 14 节补齐和改写                                        |

`ShareSendSheet/useShareSendController.ts` 不修改打开时刷新规则。首页内容刷新也不修改。

## 14. 自动检查

后续实现必须先写失败用例，再修改实现。

### 14.1 `UnifiedSpaceService.test.ts`

- 初始名单未解析；成功返回空数组后标记为已解析。
- 完整恢复开始和失败都保留已有设备。
- 设备刷新失败发布 failed 状态、保留已有设备和整体空间身份。
- 失败后下一次请求真的执行并可恢复 idle。
- 两个并发完整恢复只执行一次 Engine 查询。
- 两个并发设备刷新只执行一次 `listDevices`。
- 完整恢复在途时，设备刷新加入完整恢复，不增加 native 调用，不使状态停在 loading。
- 设备刷新在途时启动完整恢复，完整恢复最终结果生效。
- join/leave/switch 继续使旧结果失效。
- 创建、加入和移除成功发布已解析名单。

### 14.2 AppRuntime 测试

- iOS 与 Android 都只在非 active -> active 时提出一次完整刷新。
- iOS inactive/background 继续取消 peer recovery；Android 不执行 iOS 专属动作。
- `refreshRequired`、`peerPresenceChanged`、`workspaceConvergenceChanged` 和
  `pairing_completed` 触发设备刷新。
- 配对、presence 等事件连发时由服务只执行一轮在途刷新。
- 内容、剪贴板、发送、传输、network recovery 和其他 changed kind 不刷新名单。
- 后台收到设备事件不查询；回到前台由完整刷新恢复。
- 启动中的前台、网络和设备事件不会创建竞争的空间请求。

### 14.3 `useMySpaceSheet.test.tsx`

- 已有名单时连续开关面板不会调用任何刷新方法。
- 冷启动未解析时显示首次加载派生状态。
- 已知名单更新中仍返回设备行状态。
- 首次失败与已知名单失败正确区分。
- 已知空名单不被误判为首次加载。
- 下拉和 Retry 都调用完整 `refresh()`，进度持续到 Promise 真正结束。
- 用户刷新失败后仍能再次刷新。
- 统一名单出现新 `deviceId` 时，现有邀请成功提示仍工作。

### 14.4 UI 与接线测试

- 改写 `MySpaceSheetUi.test.ts` 中“打开就刷新”的旧断言。
- Android 源码使用 `PullToRefreshBox`，iOS 源码使用 `refreshable`。
- 两端 loading、error、empty、rows 的显示条件互斥且一致。
- 已有行不放在刷新/失败条件的反向分支中。
- `UnifiedSpaceSetupUi.test.ts` 不再要求通用 `refreshRevision` 设备刷新。
- `useAddSyncConnectionFlow.test.tsx` 用统一名单变化证明配对完成。
- native host 测试确认不存在 `SharedDeviceRefreshChanged`，generic changed 仍映射 kind。
- 四种语言都包含新错误文案。

### 14.5 质量门禁

```bash
npm run core:prepare
npm run core:verify
npm test -- --runInBand
npm run type-check
npm run lint
npm run format-docs:check
git diff --check
```

`core:verify` 未通过时，不得把 TypeScript 测试通过等同于双端可构建。

## 15. 双端真机验收

iOS 与 Android 必须分别在实际设备上完成。模拟器结果单独记录，不能替代真机。

| 场景           | 操作                                   | 预期                                                        |
| -------------- | -------------------------------------- | ----------------------------------------------------------- |
| 冷启动立即打开 | 杀进程后启动，Home 出现即打开 My Space | 先显示首次加载；名单到达后原地出现，不关闭面板              |
| 重复打开       | 已有名单后连续关闭/打开 3 次           | 每次立即显示；日志中没有因 visible 变化产生的 `listDevices` |
| 自动更新       | 保持面板打开，让另一设备上下线         | 旧行不消失；状态原地变化；不出现下拉进度                    |
| 新设备加入     | 面板打开时完成一次邀请配对             | 新设备按 `deviceId` 出现；邀请成功提示正常；面板不重置      |
| 设备移除       | 从另一端或当前端移除设备               | 行原地移除；其他设备不闪烁                                  |
| 已有名单离线   | 断网后触发前台或设备更新               | 原设备仍可见；出现错误和 Retry，不显示空名单                |
| 首次恢复失败   | 在没有成功名单时制造恢复失败           | 显示失败和 Retry，不显示“没有设备”                          |
| 用户下拉       | 在正常、离线、恢复后各下拉一次         | 两端原生进度持续到真实完成；行始终可操作                    |
| 回到前台       | 后台期间改变设备状态，再回到应用       | iOS、Android 都自动更新一次；重复 active 不并发             |
| Android 通知栏 | 展开和收起通知栏但不切换 AppState      | 不刷新名单                                                  |
| 触发风暴       | 配对/在线/refreshRequired 快速连续出现 | 只有一轮重叠查询；无 loading 闪烁、空白或旧错误回写         |
| 完整恢复竞争   | 启动恢复未结束时打开面板并触发设备事件 | 完整恢复最终发布，当前空间身份正确，状态不滞留 loading      |

验收记录必须分开写明:

- 自动检查结果。
- iOS 模拟器结果。
- Android 模拟器结果。
- iOS 真机结果。
- Android 真机结果。

未执行的项目写“未执行”，不能写成通过。

## 16. 实施顺序

### 阶段 0: 恢复可信基线

1. 运行 `npm run core:prepare`。
2. 删除两端过时的 `SharedDeviceRefreshChanged` 分支。
3. 运行 `npm run core:verify`，确认固定 rc.6 的两端生成物一致。

完成标志: core 校验通过，generic `pairing_completed` 可由 JS 测试观察。

### 阶段 1: 最小端到端切片

1. 先补名单状态和完整/轻量刷新竞争的失败测试。
2. 在现有 store/service 中实现两个状态字段、失败保留和请求优先级。
3. 让 AppRuntime 处理 `pairing_completed` 与 presence 事件。
4. 删除 My Space 的打开刷新，让现有设备行直接消费统一快照。
5. 同时修正两端首次 loading/error/empty 互斥条件。

完成标志: 从一条真实设备事件到 service、store、已打开面板的最短链路跑通；重复打开
不请求，完整恢复不会被轻量刷新压掉。

### 阶段 2: 用户主动刷新

1. 先补两端原生刷新和 Promise 时长测试。
2. Android 接入 `PullToRefreshBox`。
3. iOS 接入 `refreshable`。
4. 增加四语言错误文案并统一 Retry。

完成标志: 两端主动刷新可用，自动刷新不显示主动进度，失败后可再次操作。

### 阶段 3: 收敛重复触发

1. 删除两个 Settings 页面和邀请等待流程对通用 `refreshRevision` 的设备查询。
2. 让这些界面只观察统一名单。
3. 证明内容和传输事件不再调用 `listDevices`。

完成标志: 设备刷新触发只剩第 6.1 节列出的路径，分享页例外保持不变。

### 阶段 4: 完整验证

1. 运行第 14.5 节全部门禁。
2. 完成第 15 节模拟器与双端真机矩阵。
3. 检查日志中的请求次数、最终空间身份和名单内容。

完成标志: 自动检查全绿，iOS/Android 真机验收全部有明确证据。

每个阶段都保持可构建、可运行，不引入临时接口、兼容层或未使用配置。

## 17. ADR 验收对应

| ADR 验收标准                              | 本规格证明                |
| ----------------------------------------- | ------------------------- |
| 1. 恢复名单后重复打开立即显示             | 第 6.2、10、14.3、15 节   |
| 2. 启动后立即打开先加载再原地更新         | 第 5.3、12.1、15 节       |
| 3. 后台更新期间设备行可见可操作           | 第 4、5.3、11、15 节      |
| 4. 更新失败保留名单并可重试               | 第 5、10、11.3、14、15 节 |
| 5. 加入、移除、在线变化更新且重复触发合并 | 第 6、7、8、14.2、15 节   |
| 6. iOS 与 Android 都覆盖                  | 第 11、14.4、15 节        |

## 18. 研究依据

- Expo SDK 56: https://docs.expo.dev/versions/v56.0.0/
- Expo SwiftUI `refreshable`:
  https://docs.expo.dev/versions/v56.0.0/sdk/ui/swift-ui/modifiers/#refreshablehandler
- Expo Compose `PullToRefreshBox`:
  https://docs.expo.dev/versions/v56.0.0/sdk/ui/jetpack-compose/pulltorefreshbox/
- React Native 0.85 AppState: https://reactnative.dev/docs/0.85/appstate
- Apple SwiftUI refreshable:
  https://developer.apple.com/documentation/swiftui/view/refreshable(action:)
- Android pull-to-refresh:
  https://developer.android.com/develop/ui/compose/components/pull-to-refresh
- Android offline-first data layer:
  https://developer.android.com/topic/architecture/data-layer/offline-first
- TanStack Query background fetching:
  https://tanstack.com/query/latest/docs/framework/react/guides/background-fetching-indicators
- TanStack Query React Native focus refresh:
  https://tanstack.com/query/latest/docs/framework/react/guides/window-focus-refetching
