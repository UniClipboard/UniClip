# 规格 002：移动端空间设备管理与设备关系核对

## 文档状态

- 状态：实现完成，正式验收待执行
- 修订日期：2026-08-15
- 产品依据：`docs/prd/2026-08-15-mobile-space-device-management.md`
- 升级来源：移动端正式版 `v1.3.0.165`
- 目标 Engine：`v1.1.0-rc.2`，提交 `49976d5ea21c5d448d9ef5df2c581b77abeb52cf`，或后续包含相同修复的版本
- Engine 契约：Engine `docs/specs/021-device-trust-reconciliation-product-contract.md`
- Engine 当前成员范围：Engine `docs/specs/022-current-member-runtime-scope.md`
- 真实升级验收：`docs/tests/mobile-engine-upgrade-compatibility.md`

本次修订替代 2026-08-14 版本。旧版中“不同空间、已移除设备长期保留在当前空间列表”和
“设备关系查询失败时按普通设备名单显示为可用”两项规则失效。当前产品行为以本规格和上述 PRD
为准。

本文只规定移动端如何消费 Engine 的完整结果。成员资格、变化来源、选择影响、同步关系和决定顺序
继续由 Engine 唯一负责，移动端不得从在线状态、旧名单、设备数量、版本号或消息到达顺序重新判断。

## 1. 目标与非目标

### 1.1 目标

1. 首页“我的空间”和设置“空间”使用同一份当前成员与状态投影。
2. 两个入口进入同一套设备详情，设置保留完整管理能力，首页只负责快速查看与添加。
3. 已移除或明确属于不同空间的设备从当前空间列表移出，但在刚完成操作的结果页中说明。
4. 保留现有全局、不可绕过的空间变化决定流程，并为所有高影响操作增加结果页。
5. 区分普通离线、需要更新、无法验证、查询不可用和数据损坏，不把异常显示成正常同步。
6. 对待决定、需要更新和无法验证状态发送一次通知，点击后先刷新再进入当前有效页面。
7. 从 `v1.3.0.165` 使用正式应用身份原地升级，保留历史、设置、缓存、空间和本机身份。

### 1.2 非目标

- 不实现空间合并、恢复旧成员资格、分叉内容补发或设备组自动修复。
- 不建立移动端成员规则、第二份待决定队列或持久化设备关系快照。
- 不通过清数据、退出空间、重新配对或重建空间处理升级失败。
- 不为 iOS 自建应用包下载器；没有真实发布入口时不展示虚假更新动作。
- 不把 Engine 内部进度、历史摘要、错误文本或设备标识直接暴露给用户。

## 2. 当前实现与差距

现有实现应原地扩展，不新增第二套空间管理体系。

| 现有模块                                        | 保留职责                       | 本轮差距                                                 |
| ----------------------------------------------- | ------------------------------ | -------------------------------------------------------- |
| `src/features/space/store.ts`                   | 发布统一空间快照               | 不能区分未查询、读取失败和损坏；缺少临时结果与导航意图   |
| `src/features/space/internal/spaceService.ts`   | 刷新排序、并发去重、决定串行化 | 移除后未刷新完整设备关系；离开后结果立即丢失             |
| `src/features/space/deviceTrustPresentation.ts` | 把 Engine 结果转为展示模型     | 展示字段不足；错误回退成正常；未过滤已移除和不同空间设备 |
| `DeviceTrustDecision.*`                         | 全局不可跳过的决定界面         | 成功后直接关闭，没有结果页                               |
| `MySpaceSheet.*`                                | 首页快速查看、添加设备         | 设备不能进入详情，概览可能固定显示正常                   |
| `UnifiedSpaceSetup.*`、iOS `SpacePage`          | 设置中的空间管理               | 两端分别维护展示逻辑，仍混用旧变化摘要                   |
| `deviceTrustNotificationCoordinator.ts`         | 已授权时通知待决定变化         | 仅支持一种通知、仅进程内去重、无点击跳转                 |
| Android `AboutSection`                          | 检查、下载并安装 Android 更新  | iOS 没有等价更新流程或已配置的 App Store 入口            |

Engine rc.2 没有改变现有设备关系查询、决定返回和 `deviceTrustChanged` 事件结构。移动端无需新增
Engine 业务接口；需要采用的变化是旧空间迁移、损坏状态 `1394`、已移除设备退出普通运行范围，以及
只有对方接纳后才报告在线。

## 3. 所有权与数据流

### 3.1 Engine 唯一负责

- 当前空间及成员资格；
- 当前变化、来源、目标、允许选择及两种选择的影响；
- 每台设备的在线情况、空间关系、兼容性、同步关系和可用动作；
- 移除、退出和决定的最终结果；
- 旧空间迁移、损坏识别、持久化、重启恢复和实际同步门禁。

### 3.2 移动端负责

- 查询、校验并发布完整结果；
- 保证旧请求不覆盖新状态，保证高影响操作不重复提交；
- 生成当前空间列表、详情、决定和结果页的纯展示模型；
- 管理页面选择、临时操作结果、通知去重和通知点击意图；
- 在两端使用各自原生界面实现相同产品含义；
- 按正式应用身份执行升级与真实多设备验收。

### 3.3 主数据流

```text
启动 / 回前台 / deviceTrustChanged / 通知点击 / 高影响操作完成
  -> UnifiedSpaceService 发起完整刷新
  -> querySpaceState + listDevices + queryDeviceTrust
  -> platform/engine 只解析一次 Engine 结构和结构化失败
  -> UnifiedSpaceSnapshot 原子发布
  -> 当前成员投影 + 空间概览 + 设备详情 + 全局决定
  -> 通知协调器只比较状态变化，不改变业务状态
```

事件只表示“旧快照失效”。移动端不合并增量，也不根据事件内容修改单台设备。

## 4. 统一状态设计

### 4.1 设备关系查询状态

用显式联合状态替代 `deviceTrust: null` 的多重含义：

```ts
type DeviceTrustQueryState =
  | { kind: 'idle' }
  | { kind: 'loading'; previous: DeviceTrustSnapshot | null }
  | { kind: 'ready'; snapshot: DeviceTrustSnapshot }
  | { kind: 'notApplicable' }
  | { kind: 'unavailable'; failure: DeviceTrustFailure }
  | { kind: 'failed'; failure: DeviceTrustFailure }
  | { kind: 'corrupt'; failure: DeviceTrustFailure };

type DeviceTrustFailure = {
  operation: 'queryDeviceTrust';
  code: number | null;
  category: string | null;
  retryable: boolean;
};
```

规则：

- `notApplicable` 只用于 Engine 明确返回当前没有空间。
- `loading.previous` 只用于避免刷新闪烁，页面必须同时显示正在刷新，不能把旧值宣称为最新。
- 失败后不把普通名单投影成 `usable`。普通名单只能补设备名称和本机标识，全部关系显示为无法验证，
  且不提供移除等高影响动作。
- 不持久化 `DeviceTrustSnapshot`。重启后重新查询 Engine。
- 决定错误与查询错误分开保存，避免一个失败覆盖另一个页面状态。

### 4.2 当前空间设备展示模型

`buildCurrentSpaceDeviceViews()` 是列表和详情的唯一纯投影。每项至少包含：

```ts
type CurrentSpaceDeviceView = {
  deviceId: string;
  displayName: string;
  isLocal: boolean;
  reachability: 'online' | 'offline' | 'unknown';
  membership: 'active' | 'unavailable' | 'unknown';
  groupRelationship: 'consistent' | 'pendingLocalDecision' | 'unverifiable' | 'unknown';
  compatibility: 'compatible' | 'upgradeRequired' | 'unknown';
  syncRelationship: DeviceSyncRelationship;
  primaryStatus: DevicePrimaryStatus;
  canSync: boolean;
  canRemove: boolean;
  canUpdateThisDevice: boolean;
  blockedReason: DeviceTrustUnavailableReason | null;
};
```

名称重复时继续添加稳定设备编号的短后缀，仅用于当次展示。展示模型不保存身份副本。

### 4.3 空间概览

首页和设置共用 `SpaceOverviewView`：当前成员数量、主要空间状态、是否存在待决定项和刷新状态。
概览状态按下列顺序选择最高优先级：

1. 需要确认空间变化；
2. 无法验证设备资料或查询损坏；
3. 需要更新；
4. 正在更新空间；
5. 正常同步或仅有离线设备；
6. 无空间。

离线只作为设备的补充状态，不让整个空间显示警告。存在任何阻止同步的关系时不得显示“同步正常”。

### 4.4 高影响操作与临时结果

`UnifiedSpaceSnapshot` 增加一个进程内状态，不落盘：

```ts
type SpaceOperationState =
  | { kind: 'idle' }
  | { kind: 'submitting'; operation: SpaceOperationContext }
  | { kind: 'result'; result: SpaceOperationResult };

type SpaceOperationKind = 'removeMember' | 'applyChange' | 'keepCurrentSpace' | 'leaveSpace';
```

`SpaceOperationResult` 保存本次动作类型、本机是否仍在原空间、确认后的可同步设备、已移除或属于其他
空间的设备、结果是否完成验证，以及“离线设备可能稍后处理”的提示条件。设备名称来自操作前后完整
快照，Engine 结果仍是关系事实来源。

结果状态只为当前操作提供页面上下文：

- 点击“完成”、空间编号被替换或开始另一项高影响操作时清除；
- 应用被终止后不恢复结果页，重启只恢复 Engine 当前事实；
- 结果刷新失败时显示“空间已提交，但最新设备资料暂时无法验证”，不得重复提交原操作；
- 若决定返回下一项 `currentChange`，先显示当前结果页；点击“完成”后立即显示下一项不可跳过的决定，
  用户不能借结果页返回普通应用。

### 4.5 通知导航意图

通知点击先写入单一待处理意图，不直接操作导航器：

```ts
type SpaceNavigationIntent =
  | { kind: 'reviewCurrentChange' }
  | { kind: 'openDevice'; condition: 'upgradeRequired' | 'unverifiable'; fingerprint: string }
  | { kind: 'openSpaceManagement'; reason: 'unverifiable' };
```

`AppRuntime` 等导航与 Engine 可用后执行完整刷新，再解析意图。找不到目标、状态已经恢复或设备已经
离开当前空间时，打开当前空间管理页；没有空间时返回首页。一次意图只消费一次，重复回调幂等。

## 5. 当前成员投影规则

### 5.1 列表纳入与排除

当查询为 `ready` 时，只展示当前空间成员：

- 明确 `membership=removed` 的设备排除；
- `groupRelationship=diverged` 排除；
- `syncRelationship` 为 `pausedGroupDiverged`、`removedLocalDevice` 或 `removedPeerDevice` 排除；
- 本机 `localMembership=removed` 时当前空间列表为空，进入已退出状态；
- `unavailable`、`unknown`、`unverifiable`、`upgradeRequired` 和等待决定不能被排除，因为不确定不等于
  已经离开。

普通 `listDevices` 仍由 Engine 当前成员范围过滤。它在设备关系查询失败时仅用于保留可识别设备行，
所有行统一标为无法验证且禁用操作；不能用它覆盖关系事实。

### 5.2 状态优先级

单台设备的主要状态固定为：

1. `waitingForLocalDecision`：需要确认空间变化；
2. `pausedUnverifiable` 或查询不可用：无法验证设备资料；
3. `pausedUpgradeRequired`：需要更新；
4. 进行中的本地操作：正在更新空间；
5. `usable`：正常同步，再补充在线或离线；
6. `unknown`：状态暂不可用，不推断为离线或正常。

只有 `syncRelationship=usable` 才能显示“可以同步”。`reachability=online` 不能改变主要状态。

### 5.3 详情动作

- 本机永不显示“移除设备”。主动退出只在设置“空间”页提供。
- 远端“移除设备”仅在关系查询为 `ready`、设备仍是当前活跃成员、没有待决定变化、没有无法验证
  限制且当前没有其他高影响操作时可用；最终仍由 Engine 验证。
- `updateThisDevice` 只在 Engine 的 `availableActions` 包含该动作时可用。
- 远端需要更新只说明“请在该设备上更新”，不提供本机无效按钮。
- `rejoinDeviceGroup` 当前版本不可用时不展示恢复入口，只说明以后需使用新邀请重新加入。
- `blockedReason` 只映射成产品文案，不显示内部枚举值。

## 6. 刷新、并发与失败关闭

`UnifiedSpaceService` 继续是唯一状态负责人，并保留现有本地 revision 规则。

### 6.1 完整刷新

1. 启动、回前台、Engine 变化事件、通知点击和高影响操作完成后触发刷新。
2. `querySpaceState` 决定是否存在空间；无空间时清除旧空间关系并发布 `notApplicable`。
3. 有空间时并行读取 `listDevices` 与 `queryDeviceTrust`，但分别记录结果。
4. 普通名单成功、设备关系失败时仍发布可识别设备和明确的失败状态，不让整个空间退化为空白，也不
   宣称关系正常。
5. 设备关系成功、普通名单失败时可展示关系快照；列表刷新提示失败，但不丢弃更权威的关系结果。
6. 只有同一刷新序号且空间编号未变化的结果可以发布。

### 6.2 决定

保留现有规则：只允许一个请求、提交前核对 `changeId` 和 `allowedChoices`、本机退出与保留当前空间
需要二次确认、失败不自动重提决定、`stateChanged` 和 `alreadyCompleted` 采用返回快照。

成功后不再只写 `deviceTrustDecisionOutcome`：根据实际返回和操作前上下文生成
`SpaceOperationResult`。决定返回的完整快照先发布；必要时再做一次完整普通名单刷新，旧请求不得覆盖。

### 6.3 主动移除

1. 从详情页记录目标和操作前完整快照，显示包含影响说明的确认。
2. 提交后进入 `submitting`，所有冲突动作禁用，页面显示“正在更新空间”。
3. `removeMember` 成功后必须重新读取 `listDevices` 和 `queryDeviceTrust`，不能只刷新普通名单。
4. 根据操作结果和新快照生成结果页。目标从当前列表移出；离线设备传播情况只作保守说明。
5. 后置刷新失败时仍保留 Engine 已接受操作这一结果，不自动重提；结果页明确最新名单尚未验证。

`workspaceConvergence` 可以保留为兼容返回值，但不再作为长期页面、待办或设备关系来源。

### 6.4 主动退出

1. 只从设置页发起，确认文案说明仅本机退出、本地历史保留、以后需要新邀请。
2. 调用 `leaveSpace` 前记录原空间展示上下文；成功后发布空空间和 `leaveSpace` 结果。
3. 结果页中本机状态为已退出、当前可同步设备为空；原空间其他设备只说明继续使用原空间，不声称
   它们已经在线或完成处理。
4. 点击“完成”回到正常首页和添加设备入口，不自动创建或加入空间。

## 7. 查询错误与用户行为

Engine 错误编号按操作解释，不能建立全局数字映射。`queryDeviceTrust` 边界处理如下：

| 查询结果                        | 状态            | 用户行为                                           | 自动行为                             |
| ------------------------------- | --------------- | -------------------------------------------------- | ------------------------------------ |
| 成功                            | `ready`         | 正常显示关系与动作                                 | 按事件继续刷新                       |
| 无空间                          | `notApplicable` | 显示未连接状态                                     | 无                                   |
| `1392`                          | `unavailable`   | 显示设备关系暂不可用，不显示修复动作               | 启动、回前台或新事件时再查           |
| `1393`                          | `failed`        | 显示暂时无法验证，保留名单与数据，禁用高影响操作   | 仅按正常生命周期再查，不循环重试     |
| `1394`                          | `corrupt`       | 明确空间设备资料损坏且无法安全验证；不暴露内部信息 | 不覆盖、不删除、不重建原数据         |
| 非法 JSON / 未知枚举 / 其他错误 | `failed`        | 按无法验证处理                                     | 记录稳定错误类别，等待下一次完整刷新 |

两端原生桥必须让 TypeScript 可靠取得 `code`、`category` 和 `retryable`，或在
`src/platform/engine` 提供同等的结构化错误。禁止匹配异常 message 或读取系统日志来决定页面。

错误文案不得建议清空数据、重新安装或重新配对。`retryable` 只决定后台是否可在下一正常时机尝试，
不生成无限循环，也不在当前没有恢复能力时显示手动“修复”。

## 8. 页面与组件边界

### 8.1 共享控制层

新增纯控制器/展示模型，供首页和设置共同使用：

- `useSpaceDeviceManagement`：选择当前设备、读取共享投影、发起确认后的操作；
- `SpaceDeviceDetail.types.ts`：详情属性和回调；
- `SpaceOperationResult.types.ts`：结果页属性和完成动作；
- `deviceTrustPresentation.ts`：列表、详情、概览和结果的纯映射。

页面只负责“从哪里打开”和“完成后回哪里”。状态优先级、动作可用性、确认内容和结果内容不得在
首页与设置各写一份。

### 8.2 平台组件

新增或扩展以下平台文件，不在共享组件内使用 `Platform.OS`：

```text
SpaceDeviceDetail.tsx            -> export * from './SpaceDeviceDetail.android'
SpaceDeviceDetail.android.tsx    -> Compose / Material 3
SpaceDeviceDetail.ios.tsx        -> SwiftUI / Liquid Glass
SpaceDeviceDetail.types.ts       -> 共享属性

SpaceOperationResult.tsx         -> export * from './SpaceOperationResult.android'
SpaceOperationResult.android.tsx -> Android 结果页
SpaceOperationResult.ios.tsx     -> iOS 结果页
SpaceOperationResult.types.ts    -> 共享属性
```

优先复用现有 `IosSheetPage`、`SheetPageTransition`、`AppAlertDialog`、`AppBottomSheet`、按钮、行和文字
组件。若缺少破坏性按钮、禁用态或尾部内容，应小幅扩展现有公共组件，不能复制一套触摸与无障碍实现。

### 8.3 页面承载

- 首页：`MySpaceSheet` 显示概览和设备行；设备行可进入详情；只保留添加设备动作。
- iOS 设置：沿用 `SpacePage` 的内部 `SheetPageTransition` 页面栈承载同一详情。
- Android 设置：沿用现有设置子页面和 Compose 容器承载同一详情。
- 结果页：挂在应用导航之上的统一空间操作层，保证来自设置、首页或全局决定的操作采用同一结果。
- 全局决定：继续位于导航之上且不可关闭。结果页存在时只允许“完成”；完成后若仍有当前变化，立即
  回到全局决定。

设备详情至少按“身份、在线情况、空间归属、同步能力、版本/资料状态、可执行动作”分组。内部字段
缺失时显示“状态暂不可用”，不留空也不猜测。

## 9. 更新动作

- Android 本机需要更新时，进入现有 About 更新流程，复用检查、发布说明、APK 下载和安装能力。
- iOS 当前没有应用内更新流程，也没有已配置的 App Store 产品地址。实现时只有在加入并验证真实生产
  App Store/发布入口后才可显示“前往更新”；否则详情只说明本机需要更新并把动作标为当前不可用。
- 另一台设备需要更新时，只指引用户在那台设备上更新。
- 更新完成后依靠启动、回前台或 Engine 事件重新读取关系，不要求重新配对，不由移动端提前清除状态。

## 10. 通知与点击跳转

### 10.1 触发条件

只通知从“不存在”变为“存在”的三个事件：

- 当前 `changeId` 需要本机决定；
- 当前空间某设备进入 `upgradeRequired`；
- 当前空间某设备进入 `unverifiable`，或设备关系查询明确返回 `corrupt` 且无法定位单台设备。

`unavailable`、普通 `failed`、普通离线、刷新失败重试、用户刚完成的移除/退出/空间分开不通知。
通知权限未授予时不主动申请，应用内状态与强制决定仍完整工作。

### 10.2 去重

去重按“异常事件的一次持续出现”而不是按应用进程：

1. 对通知类型和 Engine 稳定标识生成 SHA-256 不透明指纹；不保存原始设备名、设备编号、空间编号或
   `changeId`。
2. 在现有应用本地存储中只保存当前仍活跃的指纹集合。
3. 新快照中新出现的指纹通知一次；持续存在不重复；恢复后移除指纹；以后再次出现可再次通知。
4. 用户自己刚完成的操作不进入通知集合。
5. 通知权限关闭时仍记录本次已观察状态，避免以后授权后为旧状态补发误导通知。

通知数据只携带类型和不透明指纹。可见标题与正文不包含设备名称、完整标识或关系图。

### 10.3 点击处理

使用 Expo 56 的 `getLastNotificationResponse()` 恢复冷启动点击，使用
`addNotificationResponseReceivedListener()` 处理运行中的点击，两者进入同一个幂等协调器：

1. 保存待处理导航意图；
2. 等待 Engine 和导航就绪；
3. 完整刷新；
4. 待决定通知打开当前决定界面；
5. 更新/无法验证通知用指纹匹配当前设备并打开详情；
6. 无法匹配时打开设置中的空间页；状态已恢复且没有空间时回首页；
7. 消费后调用 `clearLastNotificationResponse()` 清除通知响应，防止每次启动重复跳转。

通知不能携带直接决定按钮，也不能在刷新前按旧 payload 打开或操作某台设备。

## 11. 升级与数据保护

### 11.1 Engine 采用

开发阶段可继续使用 `modules/uc-engine/core-source.json` 的可复现本地提交构建。发布候选必须采用
`v1.1.0-rc.2` 或明确包含同等修复的后续正式版本，且发布清单中的版本、源码提交和生成物一致。

不得为了等待 Engine 发布阻塞界面和服务层实现，但本地构建不能被报告为正式发布验收。

### 11.2 原地升级规则

- iOS 和 Android 候选包必须使用与 `v1.3.0.165` 相同的生产应用身份和存储位置。
- 开发包可以验证界面和单机行为，不能证明正式版原地升级。
- 历史、收藏、删除结果、设置、图片/文件缓存、空间和本机身份均原样保留。
- Engine 负责旧加密空间的版本化读取与幂等重写；移动端不复制迁移状态。
- 迁移或查询失败时保留原数据，禁止自动退出、创建空空间、覆盖或清理。
- 多次冷启动结果必须稳定，不重复导入、不重复决定、不改变已经完成的关系。

详细样本、设备矩阵、证据和发布门槛直接执行
`docs/tests/mobile-engine-upgrade-compatibility.md`，不能用新安装代替。

## 12. 文件变更范围

预计实施范围如下，实际命名可以按现有目录微调，但职责不得跨层：

| 范围                                                           | 变更                                                       |
| -------------------------------------------------------------- | ---------------------------------------------------------- |
| `src/platform/engine/`                                         | 结构化 Engine 错误、既有设备关系解析测试                   |
| `src/features/space/store.ts`                                  | 查询状态、操作状态、结果和导航意图                         |
| `src/features/space/internal/spaceService.ts`                  | 分离刷新结果、移除后完整刷新、结果生命周期                 |
| `src/features/space/deviceTrustPresentation.ts`                | 当前成员筛选、概览、详情、动作和结果投影                   |
| `src/components/MySpaceSheet.*`                                | 共享概览、设备详情入口、删除高影响动作                     |
| `src/screens/settings/UnifiedSpaceSetup*`、`ios/SpacePage.tsx` | 共用详情与完整管理，移除旧变化摘要展示                     |
| `src/components/SpaceDeviceDetail.*`                           | 两端设备详情                                               |
| `src/components/SpaceOperationResult.*`                        | 两端结果页                                                 |
| `src/components/DeviceTrustDecision.*`                         | 成功后进入结果，保留不可关闭规则                           |
| `src/platform/deviceTrustNotification*`                        | 三类通知、持久去重、点击响应                               |
| `src/navigation/`、`AppRuntime`                                | 待处理意图、刷新后导航、冷/热启动消费                      |
| i18n 资源                                                      | 统一“空间”术语和新增状态、详情、确认、结果、错误、通知文案 |

不新增独立设备管理 store，不改 Engine 成员算法，不把 `workspaceConvergence` 恢复成长期 UI 来源。

## 13. 实施顺序

每一阶段保持可运行并通过对应测试后再进入下一阶段：

1. **状态底座**：结构化错误、显式查询状态、当前成员投影与现有列表接入。
2. **共享详情**：先让首页和设置进入同一详情，再迁移移除确认和本机/远端动作规则。
3. **结果闭环**：主动移除、采用变化、保留当前空间和主动退出均生成临时结果；补齐刷新竞态。
4. **通知闭环**：三类状态转换、持久去重、冷/热启动点击、刷新后目的地解析。
5. **平台与文案收口**：删除旧变化摘要展示，统一“空间”，完成两端无障碍和返回行为。
6. **升级与多设备验收**：自动测试、两端构建、正式身份原地升级、三台真实设备接收方证明。

## 14. 验证矩阵

### 14.1 自动测试

#### 状态与投影

- `idle/loading/ready/notApplicable/unavailable/failed/corrupt` 不互相混淆。
- `1392`、`1393`、`1394` 只在 `queryDeviceTrust` 操作中映射，非法结构失败关闭。
- 已移除、不同空间和对应同步关系从当前列表排除；未知、需要更新、无法验证保留。
- 查询失败的普通名单全部标为无法验证，不产生 `canRemove` 或正常同步概览。
- 首页和设置对同一输入生成相同名称、数量、主要状态和详情。
- 本机无移除动作，远端动作符合门禁，在线状态不覆盖更高优先级状态。

#### 刷新与操作

- 启动、回前台、事件、通知点击和操作完成均触发正确刷新。
- 普通名单与设备关系分别成功/失败的四种组合都原子发布正确状态。
- 乱序读取、决定期间读取、空间切换和重复点击不能覆盖新状态或重复操作。
- 主动移除后同时刷新普通名单和设备关系。
- 四类高影响操作均生成结果；“完成”清除；重启不恢复伪造结果。
- 下一项待决定变化在结果确认后立即出现，不能返回普通应用。
- 结果后置刷新失败不重复原操作，并显示未验证状态。

#### 页面与通知

- Android 返回、外部点击和 iOS 下滑不能关闭决定界面。
- 首页详情不暴露退出/切换，本机详情不暴露移除自己。
- 通知只在三类状态首次进入时产生；持续、离线、用户操作和权限关闭不误发。
- 普通查询不可用或读取失败不发资料异常通知，明确 `unverifiable` 或 `corrupt` 才发送。
- 指纹跨重启去重，恢复后移除，再次出现可重新通知；持久数据不含原始身份。
- 冷启动与运行中点击都先刷新；目标变化、消失、移出空间时使用正确回退页面。
- Android 本机更新进入现有 About 流程；iOS 未配置真实入口时不展示无效按钮。
- 平台结构测试确认共享组件无 `Platform.OS`，两端属性接口一致。

### 14.2 模拟器与单机验证

- iOS：首页/设置详情、原生页面返回、不可下滑决定、结果页、前后台、通知点击。
- Android：首页/设置详情、系统返回键、确认与结果页、前后台、通知点击、现有更新入口。
- 两端：无空间、单设备、重复名称、加载失败、需要更新、无法验证和本机退出后的历史使用。

模拟器和单机结果只证明界面与本地流程，不能证明原地升级或设备间同步。

### 14.3 正式升级与真实设备

按 `docs/tests/mobile-engine-upgrade-compatibility.md` 执行全部 P0 和适用 P1。至少三台真实设备覆盖：

- `v1.3.0.165` 到候选版的 iOS、Android 生产身份原地升级；
- 旧空间迁移、离线恢复、需要更新和损坏/不支持状态；
- 主动移除、采用变化、保留当前空间、本机被移除和主动退出；
- 决定前后终止与重启；
- 文本、图片、小文件和大文件的继续同步与停止同步。

“继续同步”必须由接收设备实际收到并保存或打开内容证明；“停止同步”必须由目标接收设备在约定
观察期内未收到新内容证明。发送方计数、配对成功、在线图标和页面可打开都不能替代接收方证据。

## 15. 完成定义

实施完成必须同时满足：

1. PRD 32 条验收标准均有自动测试、单机验证或真实设备证据对应，不能只写“人工检查”。
2. 类型检查、相关自动测试、iOS 构建和 Android 构建通过，且报告实际执行命令与测试数量。
3. 两端页面与交互已实际打开验证，不存在可绕过决定、错误详情入口或结果页死路。
4. 正式应用身份原地升级通过，原数据、空间和本机身份未被清除或替换。
5. 三设备关系变化及内容收发具有接收方证据。
6. Engine 版本、源码提交和移动端构建可追溯；本地开发构建与正式发布验证分别报告。
7. 日志、通知和证据不包含设备名称、完整设备/空间/变化编号或用户内容。

在正式 Engine 发布或真实设备资源尚未具备时，可以完成代码交付，但文档状态只能写“实现完成，正式
验收待执行”，不得写成产品适配已完成。

## 16. PRD 覆盖索引

| PRD 验收                   | 本规格章节         |
| -------------------------- | ------------------ |
| 1-5 入口与信息一致性       | 4.2、4.3、5、8     |
| 6-9 状态与设备详情         | 4.2、5.2、5.3、8.3 |
| 10-16 移除、退出与空间变化 | 4.4、6.2-6.4、8.3  |
| 17-20 通知                 | 4.5、10            |
| 21-26 升级与数据保护       | 7、11、14.3        |
| 27-32 真实多设备验收       | 14.3、15           |
