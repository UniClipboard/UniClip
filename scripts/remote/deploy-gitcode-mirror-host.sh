#!/bin/sh
# Installs the GitCode mirror wrapper and upload script on the mirror host, owned by
# root so the CI key cannot change them. Run by a maintainer after either file
# changes; the workflow refuses to run against a script that differs from its commit.
#
#   scripts/remote/deploy-gitcode-mirror-host.sh sha        # an ssh alias with root access
set -eu
host=${1:?usage: deploy-gitcode-mirror-host.sh <ssh host with root access>}
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)

scp "$here/gitcode-mirror-host.py" "$host:/tmp/gitcode-mirror-host.py"
scp "$repo/scripts/mirror-android-apk-to-gitcode.mjs" "$host:/tmp/mirror-android-apk-to-gitcode.mjs"
ssh "$host" 'set -e
install -d -m 755 -o root -g root /opt/uniclip-mirror
install -m 755 -o root -g root /tmp/gitcode-mirror-host.py /opt/uniclip-mirror/gitcode-mirror-host.py
install -m 644 -o root -g root /tmp/mirror-android-apk-to-gitcode.mjs /opt/uniclip-mirror/mirror-android-apk-to-gitcode.mjs
rm -f /tmp/gitcode-mirror-host.py /tmp/mirror-android-apk-to-gitcode.mjs
sha256sum /opt/uniclip-mirror/*'
echo "expected script sha256: $(shasum -a 256 "$repo/scripts/mirror-android-apk-to-gitcode.mjs" | cut -d' ' -f1)"
