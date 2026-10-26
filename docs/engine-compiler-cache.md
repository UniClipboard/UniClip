# Engine 编译缓存

`artifactSource=commit` 从 `core-source.json` 的不可变 Engine SHA 编译 Android AAR 或 iOS XCFramework；`release` 下载并校验发布产物，不经过编译缓存。已准备且校验通过的 native 产物复用也不是 MBX 命中。目标矩阵、release profile、绑定生成、产物校验和签名路径保持原契约。

## 快照消费入口

`update-unified-engine-core.sh` 在实际编译前，每个平台调用一次 `uc_engine_restore_snapshot`。Mobile 只选择 `mobile-product-android` / `mobile-product-ios` 场景，完整的传输、索引/归档校验、CAS 导入和失败分类由 Engine 的 `scripts/build-cache/mbx-snapshot.py` 负责。没有逐对象回退，也没有 Mobile save/publish 入口。

缓存自动化独立固定到 Engine `f44ae136f76a05e642fc22e32b823161f0716cef`（包含已合并的快照实现 #232）。这次不改变产品 pin；两者当前 SHA 相同不代表绑定两个版本。`engine-cache-tools.sha256` 固定入口脚本和 Engine 原生 `scene_key` 的全部输入；下载与复用时都校验，不能用 Mobile 工作流或缺失的 Engine 文件构造另一套协议。更新自动化时须从受信 Engine 提交重新生成该清单，并确认包含完整的 key 输入集合。

恢复 key 使用固定自动化的 Cargo/工具/工作流输入、真实 rustc、宿主 OS/架构、runner 镜像、SDK 选择、场景及实际产品工作树 SHA。拒绝继承任意 key、variant、source-root 或 writer 选择。MBX 继续逐动作核验源码、依赖、编译参数和目标；外层快照匹配不能代替编译正确性。产品临时工作树只覆盖原有五个缓存入口，`cache-entry.json` 记录产品 SHA、自动化 SHA、脚本 SHA256 和真实 dirty 文件。

远端只读现有私有桶的 `engine/mbx-snapshots/v1/<scene>/<compatibility-hash>/latest.json` 和其中指定的单个归档。Engine 验证格式、同场景 key、大小、SHA256、路径/类型/展开限制，拒绝 Cargo workspace 附件，再由原生 MBX 验证 CAS 闭包。可信 main producer 和现有桶级 reader/writer 权限仍是信任边界；前缀不是独立授权。PR 不发布快照，本地 Actions CAS 缓存继续按 ref 隔离，不扩大不可信 PR 的缓存权限。

## 冷编译与凭据

Prepare 步骤使用已有的三个可选 reader secrets：`BUILD_CACHE_R2_ENDPOINT`、`BUILD_CACHE_R2_ACCESS_KEY_ID`、`BUILD_CACHE_R2_SECRET_ACCESS_KEY`。不增加 secret、写入权限、发布环境或安全设置。Python SDK 固定为 `boto3==1.40.0`，临时安装；安装故障与远端故障一样退回本地。

缺失快照、无凭据、部分凭据、非 HTTPS、不可访问端点、损坏/不兼容归档或 SDK 不可用均不会代替真实构建。恢复报告保留 miss/no-credentials/error，后续原生编译照常执行并传播退出码。可信工具下载/校验失败仍停止：不能执行未验证自动化。无 Python 时跳过可选恢复，仍编译。

编译子进程强制 `UC_ENGINE_MBX_LOCAL_ONLY=1`，清除 R2/AWS 身份、旧环境文件、原生远端配置和 writer 标记，并用空 URL 覆盖全局 MBX 配置。即使调用方提供 `--r2`、旧 read-only 设置或全局远端配置，也不能请求逐对象缓存。凭据不传给编译或 SDK 安装子进程，不写入缓存或证据。不会执行旧的网络 sysctl 准备脚本。

## 证据与限制

现有 `mbx-*` 工件保留原生 `session.*/stats.json` 和每平台 `<android|ios>/snapshot-restore.json`。快照 hit 应为一个逻辑 index read、一个 archive read、下载字节大于零；miss 为一个 index read、零 archive read；禁用远端为零。SDK 重试可能增加实际 HTTP 请求，逻辑计数不是 R2 账单。

原生编译的 manifest/action/blob/pack 远端请求、上传和下载应全部为零。只有实际运行构建且出现原生 hits/restored files，才能把恢复称为编译复用。无编译统计不能视为零耗时命中；本地 fixture、Actions CAS 命中与独立 hosted/R2 消费证据必须分开。

当前 Engine producer 仍固定旧产品 `2f9afc99`，且 SDK/runner 镜像也可能不同。因此本次产品 `f44ae136` 可能安全 miss；不能为了命中放宽 key 或冒用旧 variant。后续生产者预热属于 Engine 所有者工作，本 PR 不修改 Engine。未取得匹配的真实 R2 消费证据前，不宣称完整 AAR/XCFramework 加速或实测费用下降。

回归：

```sh
python3 scripts/__tests__/engine-cache-snapshot.test.py
tools=$(bash scripts/engine-cache-tools.sh)
python3 "$tools/scripts/build-cache/mbx-snapshot.test.py"
node --test scripts/__tests__/engine-build-environment.test.mjs
```

独立手动缓存验收工作流要求真实快照 hit 和本地 MBX 恢复，并拒绝任何原生远端请求；普通 PR 构建允许 cold miss。只有明确授权才运行手动验收，本次不触发。
