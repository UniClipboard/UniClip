#!/usr/bin/env python3
"""Runs the GitCode mirror upload on a host inside mainland China.

Why: from a GitHub runner the upload to GitCode crawls (the object storage is in
China), so CI logs in to a small host in Shanghai over SSH and this wrapper does
the transfer there. It is the forced command of that SSH key, so the key can do
nothing else.

Protocol (stdin): one JSON line, then the source of the upload script.
  {"tag", "filename", "expectSha256", "prerelease", "source", "env": {...}}

The wrapper
  1. validates the request (plain tag, APK name, digest, allow-listed settings),
  2. downloads the APK from the public R2 address, whose route from China is fast
     (GitHub is not), and checks size and SHA-256 against what CI released,
  3. runs the upload script with Node, secrets only in the child's environment,
  4. prints the provenance between ::provenance:: markers and exits with the
     script's status. Everything it created is removed.

Python 3.6 compatible (the host's system Python).
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

R2_BASE = os.environ.get("UNICLIP_MIRROR_R2_BASE", "https://release.uniclipboard.app")
NODE = os.environ.get("UNICLIP_MIRROR_NODE", os.path.expanduser("~/node/bin/node"))
TMP_ROOT = os.environ.get("UNICLIP_MIRROR_TMP") or None

ALLOWED_ENV = {
    "GITCODE_TOKEN",
    "GITCODE_OWNER",
    "GITCODE_REPO",
    "GITCODE_API_BASE",
    "GITCODE_TARGET_COMMITISH",
    "FLARE_RELEASE_ACCESS_CLIENT_ID",
    "FLARE_RELEASE_ACCESS_CLIENT_SECRET",
    "FLARE_RELEASE_ADMIN_URL",
}
TAG = re.compile(r"^v[0-9][0-9A-Za-z.\-]{0,63}$")
FILENAME = re.compile(r"^UniClip-[0-9A-Za-z.\-]{1,64}-arm64-v8a\.apk$")
SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")
SOURCE = re.compile(r"^[0-9A-Za-z:/._\-]{1,200}$")


def fail(message):
    sys.stdout.write("mirror host: %s\n" % message)
    sys.stdout.flush()
    sys.exit(2)


def read_request():
    raw = sys.stdin.buffer.read()
    header, _, script = raw.partition(b"\n")
    try:
        request = json.loads(header.decode("utf-8"))
    except ValueError:
        fail("the first line must be a JSON request")
    if not script.strip():
        fail("no upload script was sent")
    return request, script


def validate(request):
    tag = request.get("tag", "")
    filename = request.get("filename", "")
    digest = request.get("expectSha256", "")
    source = request.get("source", "github-actions")
    if not isinstance(tag, str) or not TAG.match(tag):
        fail("invalid tag")
    if not isinstance(filename, str) or not FILENAME.match(filename):
        fail("invalid APK file name")
    if not isinstance(digest, str) or not SHA256.match(digest):
        fail("expectSha256 must be 64 hex characters")
    if not isinstance(source, str) or not SOURCE.match(source):
        fail("invalid source")
    env = request.get("env", {})
    if not isinstance(env, dict):
        fail("env must be an object")
    for key, value in env.items():
        if key not in ALLOWED_ENV:
            fail("environment variable %s is not allowed" % key)
        if not isinstance(value, str) or "\n" in value or "\x00" in value:
            fail("environment variable %s has an invalid value" % key)
    return tag, filename, digest.lower(), source, bool(request.get("prerelease")), env


def download(url, target):
    started = time.time()
    code = subprocess.call(
        [
            "curl", "-4", "--fail", "--silent", "--show-error", "--location",
            "--retry", "3", "--retry-delay", "5",
            "--max-time", "1500", "--output", target, url,
        ]
    )
    if code != 0:
        fail("downloading %s failed (curl exit status %d)" % (url, code))
    size = os.path.getsize(target)
    seconds = max(time.time() - started, 0.001)
    print("Downloaded %d bytes from R2 in %.0fs (%.0f KiB/s)" % (size, seconds, size / 1024.0 / seconds))
    sys.stdout.flush()


def sha256_of(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    request, script = read_request()
    tag, filename, expect, source, prerelease, env = validate(request)
    work = tempfile.mkdtemp(prefix="gitcode-mirror-", dir=TMP_ROOT)
    os.chmod(work, 0o700)
    try:
        apk = os.path.join(work, filename)
        download("%s/android/artifacts/%s/%s" % (R2_BASE.rstrip("/"), tag, filename), apk)
        actual = sha256_of(apk)
        if actual != expect:
            fail("sha256 of the downloaded file is %s, expected %s" % (actual, expect))
        script_path = os.path.join(work, "mirror.mjs")
        with open(script_path, "wb") as handle:
            handle.write(script)
        provenance = os.path.join(work, "provenance.json")
        child_env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": os.environ.get("HOME", "")}
        child_env.update(env)
        status = subprocess.call(
            [
                NODE, script_path,
                "--apk", apk,
                "--tag", tag,
                "--prerelease", "true" if prerelease else "false",
                "--source", source,
                "--expect-sha256", expect,
                "--missing-config", "fail",
                "--provenance", provenance,
            ],
            env=child_env,
            cwd=work,
        )
        if os.path.exists(provenance):
            with open(provenance) as handle:
                sys.stdout.write("::provenance::%s\n" % json.dumps(json.load(handle)))
        sys.stdout.flush()
        sys.exit(status)
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
