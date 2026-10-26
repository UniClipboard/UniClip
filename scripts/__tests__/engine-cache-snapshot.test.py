"""Mobile adapter tests against the checksum-pinned Engine owner (no live R2)."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
TOOLS = Path(subprocess.check_output(['bash', str(ROOT/'scripts/engine-cache-tools.sh')], text=True).strip())
spec = importlib.util.spec_from_file_location('mobile', ROOT/'scripts/engine-cache-snapshot.py')
mobile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mobile)


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.requests = []
        self.imports = []
        self.owner = None
        self.mode = 'hit'
        self.source_sha = 'f' * 40
        self.rustc = b'rustc fixture version'
        self.environment = dict(os.environ, RUNNER_TEMP=str(self.root),
            UC_ENGINE_MBX_STATS_DIR=str(self.root/'evidence'),
            BUILD_CACHE_R2_ENDPOINT='https://fixture.invalid', BUILD_CACHE_R2_ACCESS_KEY_ID='fixture',
            BUILD_CACHE_R2_SECRET_ACCESS_KEY='fixture', UC_MBX_SNAPSHOT_KEY='poison',
            UC_MBX_SNAPSHOT_VARIANT='poison', UC_MBX_SNAPSHOT_WRITER='true',
            UC_MBX_SNAPSHOT_SOURCE_ROOT='/poison', GITHUB_ENV=str(self.root/'github-env'))
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode='w:gz') as archive:
            content = b'{"version":1}'
            member = tarfile.TarInfo('mbx-cache-export-v1.json')
            member.size = len(content)
            archive.addfile(member, io.BytesIO(content))
        self.archive = output.getvalue()
        self.real_loader = importlib.util.spec_from_file_location

    def load(self, name, path):
        spec = self.real_loader(name, path)
        execute = spec.loader.exec_module
        def configure(owner):
            execute(owner)
            self.owner = owner
            # Use real key/index/archive/path validation; replace only transport and native import.
            owner.client = lambda: self
            owner.mbx = lambda *args: self.imports.append(args)
            if self.mode == 'miss':
                owner.get_index = lambda s3, key: None
        spec.loader.exec_module = configure
        return spec

    def get_object(self, Bucket, Key):
        self.requests.append(Key)
        if self.mode == 'unavailable':
            raise OSError('private URL must not appear in report')
        if Key.endswith('/latest.json'):
            key = Key.removesuffix('/latest.json')
            sha = hashlib.sha256(self.archive).hexdigest()
            index = dict(version=1, size=len(self.archive), sha256=sha, key=f'{key}/{sha}.tar.gz')
            if self.mode == 'incompatible':
                index['key'] = index['key'].replace('mobile-product-android', 'mobile-product-ios')
            payload = json.dumps(index).encode()
        else:
            payload = self.archive if self.mode != 'corrupt' else b'x' * len(self.archive)
        return dict(Body=io.BytesIO(payload), ContentLength=len(payload))

    def run_restore(self, platform='android'):
        def command(args, **kwargs):
            if args[0] == 'git': return self.source_sha + '\n'
            if args[0] == 'rustc': return self.rustc
            raise AssertionError(args)
        with patch.dict(os.environ, self.environment, clear=True), \
             patch.object(importlib.util, 'spec_from_file_location', self.load), \
             patch.object(subprocess, 'check_output', command), \
             patch.object(sys, 'argv', []), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(mobile.restore(TOOLS, self.root, platform), 0)
            self.assertNotIn('UC_MBX_SNAPSHOT_WRITER', os.environ)
            self.assertEqual(os.environ['UC_MBX_SNAPSHOT_VARIANT'], self.source_sha)
        self.assertFalse((self.root/'github-env').exists())
        return json.loads((self.root/'evidence/snapshot-restore.json').read_text())

    def test_hit_imports_one_verified_archive(self):
        for platform in ('android', 'ios'):
            self.requests.clear()
            report = self.run_restore(platform)
            self.assertEqual((report['status'], report['index_reads'], report['archive_reads']), ('hit', 1, 1))
            self.assertGreater(report['downloaded_bytes'], 0)
            self.assertEqual(len(self.requests), 2)
            self.assertTrue(all('/mobile-product-' + platform + '/' in key for key in self.requests))
            self.assertFalse(report['object_fallback'])
        self.assertEqual(len(self.imports), 2)

    def test_miss_is_one_index_and_no_import(self):
        self.mode = 'miss'
        report = self.run_restore()
        self.assertEqual((report['status'], report['index_reads'], report['archive_reads']), ('miss', 1, 0))
        self.assertFalse(self.imports)

    def test_corrupt_incompatible_unavailable_never_import_or_fallback(self):
        for mode, archives in [('corrupt', 1), ('incompatible', 0), ('unavailable', 0)]:
            self.mode = mode
            report = self.run_restore()
            self.assertEqual((report['status'], report['index_reads'], report['archive_reads']), ('error', 1, archives))
            self.assertFalse(report['object_fallback'])
            self.assertFalse(self.imports)
            self.assertNotIn('private URL', json.dumps(report))

    def test_disabled_and_invalid_credentials_do_not_request_objects(self):
        for values, status in [(('', '', ''), 'no-credentials'), (('https://fixture', '', ''), 'error'), (('http://fixture', 'a', 'b'), 'error')]:
            for key, value in zip(('ENDPOINT', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY'), values):
                self.environment['BUILD_CACHE_R2_' + key] = value
            report = self.run_restore()
            self.assertEqual((report['status'], report['index_reads'], report['archive_reads']), (status, 0, 0))
            self.assertFalse(self.requests)
            self.assertFalse(self.imports)

    def test_key_changes_for_product_toolchain_and_target(self):
        first = self.run_restore()
        android = self.requests[0]
        self.requests.clear()
        self.run_restore('ios')
        self.assertNotEqual(android, self.requests[0])
        self.requests.clear()
        self.source_sha = 'e' * 40
        self.run_restore()
        self.assertNotEqual(android, self.requests[0])
        self.requests.clear()
        self.source_sha = 'f' * 40
        self.rustc = b'changed compiler'
        self.run_restore()
        self.assertNotEqual(android, self.requests[0])
        self.assertFalse(first['object_fallback'])

    def test_compile_strips_identity_and_propagates_failure(self):
        script = '''source "$1"
uc_engine_run_build python3 -c 'import os,sys; assert os.environ["UC_ENGINE_MBX_LOCAL_ONLY"] == "1"; assert os.environ["MBX_REMOTE_URL"] == ""; assert not any(k.startswith(("BUILD_CACHE_R2_", "AWS_")) for k in os.environ); sys.exit(73)'
'''
        result = subprocess.run(['bash', '-ec', script, '_', str(ROOT/'scripts/engine-build-storage.sh')],
            env=dict(self.environment, AWS_SESSION_TOKEN='poison', MBX_REMOTE_URL='s3://poison', UC_ENGINE_MBX_ENV_FILE='/poison'))
        self.assertEqual(result.returncode, 73)


if __name__ == '__main__':
    unittest.main()
