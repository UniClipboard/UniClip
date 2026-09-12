# 移动端日志覆盖验收（2026-09-12）

## 结论

**目前不能称为全面覆盖。** 本轮逐项检查了真实导出包中的事件、失败分类、关联标识、进程来源、写入状态和截断情况，未将“按钮可用”“同步成功”或“日志条数较多”当成覆盖完成。

发现并修复了一处移动端导出缺陷：大于 512 KiB 的日志走 `File.slice().text()`，在当前 React Native Blob 实现下无法读取，导致整份 Engine 日志被遗漏。现在改用 Expo 56 的只读文件句柄读取有限字节，跳过截断的首行后再解码 UTF-8，并确保关闭句柄。截断状态也改为 `partial`。

修复不取消原有导出容量上限，因此“文件可读”仍不等于“全部记录都在包内”。

## 实测矩阵

| 范围 | 实际证据 | 结论 |
| --- | --- | --- |
| 正常文本双向同步、进程重启 | 上一轮 iOS/Android 实际 ZIP 中都有发送、接收、保存、写系统剪贴板的完成事件；这些操作均带 trace_id，保留了两个运行实例 | 对已触发的文本路径有证据；不代表图片、附件和所有失败分支 |
| iOS 加入时密码错误 | 82 条 Engine 记录，`space_admission` / `authentication_failed`，有 trace_id；详细模式，无截断、无报告丢失 | 通过；错误后首先执行导出导航，约 32 秒后生成包，不声称验证了亚秒级写入竞争 |
| Android 加入时密码错误 | 从真实错误页面导出的 ZIP 验证到了 `space_admission` / `authentication_failed`，详细模式 | 通过；前几次失败是测试返回路径/驱动问题，不能当成日志覆盖证据 |
| iOS 连接建立超时 | 暂停本轮独立对端，实际观察到 30 秒连接超时后从页面取消并导出；81 条记录，`error.phase=establish` / `error.reason=timed_out`，带 connect_id | 通过；应用会继续重试，所以不能只等一个终止错误页面 |
| Android 连接建立超时 | 同样的独立对端暂停实验，导出包保留了 `connection.finished` / `establish` / `timed_out`；后续重新进入应用后仍可找到旧运行实例的错误 | 错误保留通过；不要用当前进程的 capture_id 判断历史错误是否存在 |
| iOS 前后台切换 | 同一运行实例在后台约 21 秒后恢复；原生和 Engine 都有前后台事件，但详细模式结束为 `suspension_expiry_unknown` | **详细连续覆盖未通过** |
| Android 后台服务 | 页面实际开启后台任务；新构建在模拟器中写出 `background_service.started`、系统重启处理和销毁记录，Engine 同时记录 `host_background_service` 已启用且 observed_count=1 | 启动、系统重启、主动停止、临时停止、系统超时、任务移除和销毁均接入固定事件；本轮实际验证了启动、系统重启及销毁，其他分支由回归检查覆盖 |
| 大日志导出 | 修复前源文件超过 1 MB、写入与刷新均正常，但 ZIP 无 Engine 文件，标记 `engine_logs_unreadable`；修复后同一模拟器保留的数据能导出，两份截取后文件均逐行解析成功 | 整份遗漏已修复；仍受末尾 512 KiB 限制 |
| 接收时存储写入失败 | 对独立模拟器的测试数据库短暂持有写锁，未写入任何业务行并在 finally 回滚释放；真实收到 Rejected，Engine 记录 `clipboard_receive` / `apply` / `apply_failed` | 普通模式下新触发的拒收已在实际 ZIP 中逐条匹配确认；阶段可辨，但**原因粒度仍不足**，未指出存储被占用 |
| iOS 键盘扩展 | 解锁后在独立模拟器 Safari 实际插入桌面同步的测试文本；ZIP 含 17 条键盘原生记录及键盘 Engine 来源，包含隐藏、暂停和关闭完成 | 已证明这次运行和收尾记录被导出；扩展刷新结果仍为 notObserved，不能宣称全部内存记录已写完 |
| iOS 分享扩展 | 从应用分享测试入口、Safari 各实际调用一次；ZIP 含 6 条分享原生记录、2 个 share_attempts，均有 handoff 完成 | 已证明内容暂存和交回记录被导出；实际未出现发送页面，不能计为分享发送全流程通过 |

## 仍存在的缺口及归属

1. **前后台恢复会结束详细记录（Engine 策略）。**
   `CapturePolicy.resumed()` 明确停止当前 capture，Engine 的测试也预期 `SuspensionExpiryUnknown`。手机端实际使用 `engine.suspend()`，并非在普通暂停中错误调用 `shutdownProcessObservability`。本轮不绕过 Engine 的时长预算，也不通过放宽断言将其记为通过。
2. **每文件导出上限会丢失较早上下文（移动端导出策略）。**
   实际大文件导出只保留末尾约 512 KiB。一次较早的接收写入失败仍在源日志中，但已不在后来的截取包中。现已明确标记 `partial`，不能称为全量或完整的三天日志。
3. **存储错误分类还不完整（Engine）。**
   受控数据库占用导致的实际接收失败只输出 `apply_failed`。`ClipboardReceiveFailure::source_chain()` 仅为四类 I/O 错误生成固定链，普通 ApplyFailed 没有 error.chain。这不是 TypeScript 导出丢掉字段；源记录本身就没有更细的数据库分类。
4. **关联与进程边界仍有限。**
   正常 ZIP 中各有一条旧式 `observability.health` / `uc.task.shutdown`，没有 run_id 或进程标识。`correlationLimitedRecords=0` 只覆盖类型化事件，不能据此推断每条导出记录都有完整关联。主进程刷新也不代表扩展进程已刷新。
5. **扩展和系统日志的适用范围要明确。**
   分享扩展不运行 Engine，而是暂存内容、交接给主应用；应检查原生 shareHandoff 与 share_attempts。键盘有独立 Engine 进程，主应用开启详细记录不会自动开启它的详细记录。系统日志、旧原生调试文件、真机长时间后台、图片/附件等分支未被本轮完整覆盖。

## 可复查证据

以下均在仓库忽略的 `e2e/results/` 中，只使用独立测试空间和模拟器。

- iOS 正常：`2026-09-11T15-23-58.257Z-ios-62546/`
- Android 正常：`2026-09-11T15-44-36.056Z-android-77734/`
- iOS 密码错误：`2026-09-11T22-46-59.356Z-ios-48682/`
- iOS 超时：`2026-09-11T22-56-53.017Z-ios-25822/`
- iOS 前后台覆盖失败：`2026-09-11T23-02-17.589Z-ios-30152/`
- Android 实际导出：`log-coverage-android-debug-1789168811155/` 下的 `auth-evidence/`、`timeout-evidence/`、`background-evidence/`，及后台服务运行/停止快照。
- iOS 接收存储失败：`log-coverage-ios-debug-1789168990597/receive-write-lock-evidence.json`，释放测试写锁后正常发送成功见 `receive-after-unlock.json`。
- 大文件修复前：同目录 `share-evidence/` 中的包（这不是分享扩展通过证据）。
- 大文件修复后：同目录 `large-fixed-evidence/`。两份 Engine 文件分别为 523941 / 524159 字节，853 / 850 条记录，逐行解析成功，`unreadableFileCount=0`、`truncatedFileCount=2`。

## 验证和安全边界

- 当前 Engine 来源为 `427bd647ac1408118a37f9ee9b851754006b2be3`，未改动 Rust 或桌面源码。
- 只对独立模拟器测试数据注入短暂存储写锁，未修改业务行，已回滚释放；恢复后正常接收成功。较早的 immutable-WAL 尝试没有触发失败且已恢复，不作为拒收证据。
- 已有实际包检查中未发现已知测试剪贴板正文或错误密码进入日志。此项仅覆盖这些已知测试值，不等于完成所有隐私审计。
- 导出修复：31 项诊断包测试通过；组合回归共 58 项通过。E2E 环境检查 19 项通过，类型检查和范围内 ESLint 通过，两端构建通过，源码映射确认产物包含新读取方式。
- iOS 在保留原有真实大文件的模拟器上升级后，实际导出两份截取的 Engine 文件并逐行解析成功；Android 升级后也实际导出并解析成功，但本轮其单文件尚未超过 512 KiB，不把它称为 Android 超限文件实测。
- React Doctor 仍为 5 个错误、189 个警告；按规则与文件对比，未增加本轮问题，旧问题未扩大范围处理。
- 新增实验用 E2E 分支尚有系统界面前置条件；没有把界面未完成的扩展实验或详细连续覆盖失败计为通过。
- 本轮保留原有 PostHog 产品日志，未实现将产品操作与完整 Engine 过程一起上传。

## 修复后的新拒收现场

`log-coverage-ios-debug-1789168990597/receiver-final-evidence/` 中的真实 ZIP
`uniclip_diagnostics_2026-09-12_00-38-20.zip` 保留了 00:37:54.577 UTC 的新拒收。
它在普通模式下记录 `clipboard_receive`、`error.phase=apply`、`error.reason=apply_failed`，
并按 trace_id 与故障注入时的源记录匹配。包中没有“database is locked”的更细线索。
较早的详细模式拒收被后来的容量截断排除，原始日志保存在 `source-engine-logs/`，可对照验证这是导出容量限制，而非未生成事件。

## 解锁后的扩展补验（09:20–09:29，Asia/Shanghai）

证据目录：`e2e/results/log-coverage-ios-debug-1789175969291/`。使用本轮创建的独立 iOS 26.3 模拟器、测试空间和现有构建，未使用个人设备的数据。应用内导航和导出仍由 Maestro 执行；系统键盘设置、Safari 输入和分享面板由 Peekaboo 补验。解锁后 Maestro 仍不能正确点击系统键盘列表，分享图标点击也曾仅关闭面板，故不能把之前流程显示完成当成扩展执行证据。分享动作现改为等待实际的“Send to devices”，避免再次误报。

实际 ZIP：`extension-evidence/diagnostic-archives/uniclip_diagnostics_2026-09-12_01-29-01.zip`。逐行解析和终止事件配对结果保存于 `extension-evidence/coverage-check.json`；原始文件另存 `source-native-logs/`、`source-engine.jsonl`。

- 键盘：Safari 显示并插入 `KeyboardHistoryProbe`，截图为 `keyboard-active.png` 和 `keyboard-inserted.png`。17 条原生记录包含启动、安全恢复、隐藏、暂停成功、释放和关闭成功；这些文件中的记录逐字保留在 ZIP。
- 分享：应用内文本测试及 Safari 链接分别启动了独立扩展进程。6 条原生记录包含两个有相同 operationId 的 handoff 开始/成功对；两个 attempt 均包含 staged、handoff_started、handoff_queued。内容出现在主应用历史，但没有观察到发送页面或发送完成记录，不能把 handoff 的 succeeded 当作设备收到内容。
- 所有已导出的扩展原生记录报告 droppedRecords=0、writeFailures=0；它们不是 Engine 所有进程的全局计数。键盘、分享来源的 flushStatus 和 recordingStatus 仍为 notObserved，主应用的 completed 明确只适用于导出进程。收尾记录实际落盘已证实，但“扩展刷新成功”本身没有单独可核查的状态。
- ZIP 包含 854 条 Engine 记录，其中 5 条标记 host_keyboard_extension；主进程状态中 hostKeyboardExtension 的 notRegistered 不代表扩展从未运行，该状态仅属于主进程。分享扩展本来就不运行 Engine。
- Engine 文件再次超过容量上限，导出状态 partial、truncatedFileCount=1；原生文件 5/5 被纳入、无截断、无不可读或格式错误。主进程已报告的队列丢失、容量丢弃、写入失败计数均为 0，但不能据此保证另一个进程或更早记录完整。
- 本轮已知测试文本未出现在导出的日志正文；此结论只覆盖此测试值。

因此，“扩展日志完全缺席”的待验项已补齐；详细模式连续性、容量截断及扩展刷新结果不可确认等边界仍然存在。此次是日志覆盖验收，不将未完成的发送页面跳转称为完整分享功能通过。

## Android 后台服务补验（09:57–10:00，Asia/Shanghai）

使用更新后的开发构建和 `emulator-5554`，由 Maestro 完成首次引导并从应用设置页开启后台任务。原生日志实际出现两次 `background_service.started`，并在进程被系统重新拉起时记录 `background_service.system_restart` 与对应的成功销毁；这些记录的 droppedRecords、writeFailures 均为 0。Engine 文件同时出现 `host_background_service` 来源启用、后台状态记录，以及导出快照中的 observed_count=1。

可复查文件位于 `e2e/results/log-coverage-android-background-2026-09-12/`。本轮页面导出已触发 Engine 导出快照，但系统目录选择页没有完成保存，因此这里不新增一份 ZIP 作为证据；既有诊断包测试已验证匹配的 `native-runtime.main.*.jsonl` 会进入包内。自动流程还暴露出返回时多按一次返回键会退出应用，现已改为只在仍停留于设置首页时继续返回，并增加回归检查。
