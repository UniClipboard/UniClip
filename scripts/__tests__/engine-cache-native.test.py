"""真实 MBX cold/export/import/hit，通过 Mobile 编译入口验证零对象请求。"""
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from unittest.mock import patch

MOBILE = Path(__file__).resolve().parents[2]
TOOLS = Path(subprocess.check_output(['bash', str(MOBILE/'scripts/engine-cache-tools.sh')], text=True).strip())
spec = importlib.util.spec_from_file_location('native', TOOLS/'scripts/build-cache/mbx-snapshot.integration.py')
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)

# 用本次独占的真实 Git fixture 提供来源；不修改产品仓库或共享 CAS。
with tempfile.TemporaryDirectory(prefix='mobile-cache-native-') as temporary:
    product = Path(temporary)
    for entry in ('mbx.sh', 'env.sh', 'bin/cargo'):
        destination = product/'scripts/build-cache'/entry
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(TOOLS/'scripts/build-cache'/entry, destination)
    subprocess.run(['git', 'init', '-q', str(product)], check=True)
    subprocess.run(['git', '-C', str(product), 'add', '.'], check=True)
    subprocess.run(['git', '-C', str(product), '-c', 'user.name=Fixture', '-c',
                    'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], check=True)
    native.ROOT = product
    native.snapshot.ROOT = product
    run = subprocess.run

    def mobile_build(args, **kwargs):
        if args[:2] == ['bash', str(product/'scripts/build-cache/mbx.sh')]:
            environment = dict(kwargs['env'])
            environment.pop('UC_ENGINE_MBX_LOCAL_ONLY', None)
            environment.pop('GITHUB_ACTIONS', None)
            kwargs['env'] = environment
            args = ['bash', '-ec', 'source "$1"; shift; uc_engine_run_build "$@"',
                    '_', str(MOBILE/'scripts/engine-build-storage.sh'), *args]
        return run(args, **kwargs)

    with patch.object(subprocess, 'run', mobile_build):
        native.main()
