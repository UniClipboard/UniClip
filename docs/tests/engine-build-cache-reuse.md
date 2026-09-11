# Engine 共用构建步骤的缓存复用验证

日期：2026-09-10。

## 修改

- `scripts/engine-build-storage.sh` 中的 `uc_engine_run_build` 统一 Engine 子进程的发布调试设置与 Xcode 选择。默认保留 `line-tables-only` 调试信息；显式覆盖同时适用于两端；不改变外层应用构建环境。
- iOS 本地准备、固定版本更新、设备安装中的 Android 构建均使用这一入口。
- 固定 Cargo 依赖目录重复初始化时保留已有链接，避免在共享 `registry` 或 `git` 目录中建立自指链接。
- 保留不同工作目录并发、各自保存外盘结果与现有共享编译缓存。

## 真实验证

使用固定源码提交 `6e0095fe05b0522ddc6ecc7e7d34d915dea60a12`，在外盘临时验证工作目录连续构建两次 `uc-engine-uniffi` 共用的主机库。两次使用相同设置与编译目录，最终文件分别写入不同目录。验证与其他手机构建隔离，继续使用现有共享编译缓存。

| 检查 | 结果 |
| --- | --- |
| 发布调试设置 | 两次均为 `line-tables-only` |
| Xcode 选择 | 两次均为正式版 Xcode.app |
| 第一次 Cargo 构建请求 | 608 个单元；这里不等同于共享缓存未命中数 |
| 第二次 | 608 个单元全部标为 fresh，零个单元重新请求编译 |
| 第二次 Cargo 耗时 | 0.88 秒 |
| 两份动态库 SHA256 | 完全相同 |
| 脚本回归 | 12 项通过 |
| 临时目录 | 源码、输出与独立中间目录已回收，共享缓存保留 |

动态库 SHA256：`d2540571ad0865671548e95e37a97eb0ccfedb6ce8749a8416245f40b4c5e793`。

验收范围为两端共用的主机库。本次安卓原生目标库、完整安装包和真机安装均记为跳过。

## 回归命令

```bash
node --test scripts/__tests__/engine-build-environment.test.mjs scripts/__tests__/prepare-local-engine.test.mjs scripts/__tests__/install-dev-device.test.mjs
```

## 提交前复查（2026-09-11）

完整脚本检查发现，iOS 复用测试截取安装脚本后漏掉了正式入口的构建目录初始化，11 项检查因此在进入待测行为前退出。测试入口已补齐相同初始化；重新运行 `node --test scripts/__tests__/*.test.mjs`，24 项全部通过。
