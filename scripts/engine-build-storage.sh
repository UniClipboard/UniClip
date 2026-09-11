#!/usr/bin/env bash

# 本机按工作目录保存编译文件；每次打包临时文件独立，只有发布到手机模块时加锁。
# 其他开发机与 CI 继续使用 Engine 自身的 Cargo 输出，不按提交重复建树。
uc_engine_build_storage_enter() {
  local root="$1" script="$2"
  shift 2
  if [[ -z "${UC_ENGINE_LOCAL_TARGET_DIR:-}" ]] && command -v uni-build-storage >/dev/null 2>&1; then
    exec uni-build-storage --storage-run-mobile "$root" bash "$script" "$@"
  fi
}

uc_engine_build_target() {
  local engine_root="$1"
  if [[ -n "${UC_ENGINE_LOCAL_TARGET_DIR:-}" ]]; then
    printf '%s\n' "$UC_ENGINE_LOCAL_TARGET_DIR"
    return
  fi
  (
    cd "$engine_root"
    cargo metadata --no-deps --offline --format-version 1 |
      node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).target_directory+"\n"))'
  )
}

uc_engine_publish() {
  local root="$1"
  shift
  if command -v uni-build-storage >/dev/null 2>&1; then
    uni-build-storage --storage-publish-mobile "$root" "$@"
  else
    "$@"
  fi
}

# 只作用于 Engine 构建子进程，避免改变外层应用构建的工具选择。
uc_engine_run_build() (
  export CARGO_PROFILE_RELEASE_DEBUG="${CARGO_PROFILE_RELEASE_DEBUG:-line-tables-only}"
  if [[ -z "${DEVELOPER_DIR:-}" && -d /Applications/Xcode.app/Contents/Developer ]]; then
    export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
  fi
  "$@"
)
