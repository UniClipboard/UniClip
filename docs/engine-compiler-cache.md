# Engine 编译缓存

`artifactSource=commit` 从 `core-source.json` 的不可变 Engine SHA 编译 Android AAR 或 iOS XCFramework；`release` 下载并校验预编译产物，不经过 Rust 编译缓存。已准备且校验通过的 native 产物复用也不是 MBX 命中。

commit 构建继续调用固定 Engine 源码中的原生构建脚本，由 Engine 负责的固定 MBX 1.24.0 Cargo 入口统一缓存。Mobile 不复制 MBX 安装或分键实现。Android、iOS 检查和 IPA 工作流只缓存按 ref 隔离的本地 MBX CAS，不恢复整份 target；仍将本次 job 的输出放在独立 `engine-target`。

Prepare unified engine core 步骤接收可选的仓库 secrets：`BUILD_CACHE_R2_ENDPOINT`、`BUILD_CACHE_R2_ACCESS_KEY_ID`、`BUILD_CACHE_R2_SECRET_ACCESS_KEY`。需要为这三个名称配置具有现有私有桶 `uniclipboard-build-cache` 读取权限的 R2 凭据；对象前缀是 `engine/mbx/v1/`。不要使用移动发布的通用 Cloudflare API token 代替 S3 凭据。

三个值全部缺失时使用本地 MBX，fork 保持可构建；部分缺失或端点非 HTTPS 时提前失败。Mobile 只请求 read-only；写入仍由 Engine 的可信 CI 生产者负责。凭据只存在于该步骤及原生编译子进程，不能写入 Actions cache 或工件。没有在本改动中配置远端 secrets 或创建 environments。

保留 `MBX_STATS_REPORT` 原生统计为 `mbx-android-build-*`、`mbx-ios-build-check-*`、`mbx-build-ios-*` 工件。无编译命令时允许缺少统计，不能视为零耗时缓存命中。无 R2 凭据时使用 2 GiB 的本地 CAS 预算；使用 R2 时与 Engine/Desktop 一致，使用 20 GiB。MBX 1.18.0 的 `MBX_GC_MAX_SIZE` 同时限制动作缓存和每次会话的远端下载总量；不能把 2 GiB 当作仅限制本地磁盘，否则原生库构建会耗尽下载预算并回退编译。

同一 bucket/namespace 允许兼容动作共享，不能把 iOS、Android 和 Desktop 全部产物互换。编译器、target、源码、features、profile、依赖内容、编译参数、发现的环境值、受支持链接器/SDK 都影响分键。保持 Engine 默认路径语义，不启用 `share_workspace_root`。

本地小型真实 Engine 内容哈希消费者验证了 Mobile 构建调用函数和 Engine MBX 入口、独立 target 的恢复及输入变化后的程序输出；完整 AAR/XCFramework 和真实 R2 下载命中仍需 CI 验证。证据要求是独立 CAS 的消费者下载字节大于零、上传为零、远端错误为零，并实际运行恢复出的产物；单凭工作流通过或 target 复用不够。

Android 与 iOS 检查的 reusable workflow 声明三个可选缓存 secret，build/build-pr/release 调用方只显式转发这三个值；不转发签名或发布凭据。fork 和未配置凭据仍使用本地 CAS。

缓存自动化提交与产品 Engine pin 分开：`scripts/engine-cache-tools.sh` 固定并校验缓存负责人脚本；`update-unified-engine-core.sh` 只在任务独占的临时产品工作树覆盖五个缓存入口文件，Rust源码、Cargo.lock和发布profile保持产品pin。共享Engine checkout不修改。原生统计的`cache-entry.json`记录产品SHA、自动化SHA、脚本SHA256及真实dirty缓存文件，不宣称该临时树完全clean。MBX1.24支持显式linker下的rlib缓存；packed debug宿主链接仍可能bypass。宿主和目标统计必须分开验收。
