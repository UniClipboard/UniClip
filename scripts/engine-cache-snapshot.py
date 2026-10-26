#!/usr/bin/env python3
"""Mobile 只选择可信 Engine 场景；传输、校验与 CAS 导入仍由 Engine 负责。"""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys


def restore(tools, product, platform):
    if platform not in ("android", "ios"):
        raise ValueError("Unsupported mobile snapshot platform")
    spec = importlib.util.spec_from_file_location(
        "engine_snapshot", tools / "scripts/build-cache/mbx-snapshot.py")
    owner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(owner)
    # 不接受调用方的任意 key、源码根或 writer 设置；产品 SHA 来自实际工作树。
    os.environ.pop("UC_MBX_SNAPSHOT_WRITER", None)
    os.environ.pop("GITHUB_ENV", None)
    os.environ["UC_MBX_SNAPSHOT_VARIANT"] = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=product, text=True).strip()
    os.environ["UC_ENGINE_MBX_LOCAL_ONLY"] = "1"
    scene = "mobile-product-" + platform
    os.environ.pop("UC_MBX_SNAPSHOT_KEY", None)
    key_for_scene = owner.scene_key

    def canonical_key(selected_scene):
        # 与可信 producer 完全相同的 key 输入；不能把 Mobile 工作流冒充 Engine 工作流。
        owner.ROOT = tools
        try:
            return key_for_scene(selected_scene)
        finally:
            owner.ROOT = product

    owner.scene_key = canonical_key
    owner.ROOT = product
    sys.argv = [str(spec.origin), "restore", "--scene", scene]
    return owner.main()


if __name__ == "__main__":
    sys.exit(restore(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve(), sys.argv[3]))
