# 自动连接宿主接入与验收

状态：实现完成，Mac 与 iOS 模拟器实际验收通过；其他实体平台未执行，尚未发布。

## 责任

连接、目标选择、重试和取消由同版本 Engine 负责。移动端只报告前台和网络变化，保留手动刷新，不再执行 30 秒循环，也不把某一设备 Online 合成一份虚假的全局刷新报告。

- `src/platform/engine/engineRuntime.ts`：向原生报告机会；运行期间订阅 NetInfo，停止时取消订阅，忽略停止后迟到的手动刷新结果。
- `src/features/sync/internal/p2pSyncAdapter.ts`：恢复原生生命周期后报告前台；后台暂停仍由原生生命周期处理。
- `modules/uc-engine/src/index.ts`：三种固定机会的公共类型与薄转发。
- `modules/uc-engine/ios/NativeLifecycleHost.swift`：真正前台回调先恢复，再通知 Engine；运行中的 Engine 同样得到通知。
- Swift/Kotlin 模块把固定字符串映射到同版本 UniFFI 枚举；iOS 机会通知使用独立队列，避免被长手动操作阻塞。

本改动依赖 Engine 的 `NotifyConnectivityOpportunity`，发布前必须采用包含该操作的同版本原生库；不能配合旧发布库直接上线。
本地 Android 构建使用已有 `UC_ENGINE_LOCAL_AAR`，iOS 使用已有本地核心准备与完整校验流程，不修改用户其他工作区。

## 已执行

- 新增前台转发测试在原实现失败：没有向 Engine 报告机会；迁移后通过。
- 新增迟到手动刷新测试先失败，修复后不会在停止后重新写入在线状态。
- 全部 Jest：181 suites、1306 tests 通过。
- TypeScript 检查与本次文件 ESLint 通过。
- Swift Package：66 tests 通过，包括前台恢复、运行中再次前台、会话所有权与关闭。
- 原有扩展测试暴露 `markSynchronizedWrite` 没有更新内存已处理修订；其调用方同时保存了磁盘修订。补齐内存记录后，重复同步写入不会再次排队，同时保留随后真实复制的处理。
- 已核对原生 autolinking 指向当前工作区模块，不引用用户其他工作区的模块代码。

## 复跑

项目要求 Node 22.22.1；确保子进程的 `node`/`npx` 使用同一版本，避免旧 Node 拒绝 `.npmrc` 的类型剥离选项。

```bash
node --no-experimental-strip-types node_modules/jest/bin/jest.js --runInBand
node node_modules/typescript/bin/tsc --noEmit
swift test --package-path modules/uc-engine
```

模拟器/真机上的启动、前后台、断网与换网验证需单独记录；上述结果不等同于真实设备验收。

## 最终本机验收（2026-09-11）

本次工作区构建的完整 iOS 模拟器应用已签名、安装并实际运行，与本次 Desktop/Engine 的独立测试资料配对。完成同时冷启、两种先后启动、双方分别重启、iOS 前后台恢复六个场景，逐场景双向正文通过；自动连通后才通过真实界面“上传剪贴板”发送，未点击刷新或“立即同步”。启动/重启连通约 2–6 秒，前台恢复独立复验为 0.756 秒。

最终 Jest 181 suites / 1306 tests、Swift Package 66 tests、TypeScript 和变更文件 lint 通过。真实 iOS 核心及完整应用构建通过；Android 原生包构建未完成，Windows/HarmonyOS 等实体组合未执行。

测试准备必须包含模拟器粘贴权限和应用共享存储权限。本次使用本地签名，并以 `simctl privacy <设备> grant pasteboard <测试应用>` 设置测试粘贴权限。原有 Engine 启动会读取系统剪贴板；未完成系统确认时可能等待，不能从该等待推断自动重连失败。试验性的 JS 启动顺序调整已撤回，未包含在交付中。

完整应用编译同时核对了新版可空传输记录编号，缺少编号的通知不映射为具体历史记录。当前 typed 日志导出不包含普通自动连接运行诊断，不能仅凭导出记录数量宣称两端连接证据完整。

## 严格审查后来源更新（2026-09-11）

Engine 修复已提交为 `ac9a50a787a3280e1657c9d56edd26b207bc67de`。从该干净提交重新构建的
iOS 设备、Apple 芯片模拟器、Intel 模拟器三种包全部通过，并已通过现有本地准备入口安装到本工作区。
来源记录核对为同一提交，未提交改动摘要为空；来源脚本的 2 项测试通过。

本地包不能替代正式发布来源：`core-source.json` 仍指向已发布的 `v1.1.0-rc.14`，
不能把旧包的版本和校验信息改写成新提交。正式采用尚待发布包含上述修复的新 Engine 包，
再通过既有采用脚本统一更新来源与校验信息。Android 新包、完整应用重建与本轮产品配对场景未执行；
前节产品模拟器验收属于初轮实现，不属于本次提交的产品运行证据。
