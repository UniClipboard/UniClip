#!/bin/sh
# Builds the one-activity helper APK from source into $1 (a scratch directory). No Gradle needed.
set -eu
out=${1:?output directory}
here=$(cd "$(dirname "$0")" && pwd)
sdk=${ANDROID_HOME:-$HOME/Library/Android/sdk}
bt=$sdk/build-tools/36.0.0
jar=$sdk/platforms/android-36/android.jar
mkdir -p "$out/classes"
"$bt/aapt2" link --manifest "$here/AndroidManifest.xml" -I "$jar" --min-sdk-version 29 --target-sdk-version 36 -o "$out/base.apk"
javac --release 8 -cp "$jar" -d "$out/classes" "$here"/src/*.java
"$bt/d8" --min-api 29 --lib "$jar" --output "$out" "$out"/classes/test/clipboardfixture/*.class
(cd "$out" && cp base.apk unsigned.apk && zip -q -j unsigned.apk classes.dex)
"$bt/zipalign" -f 4 "$out/unsigned.apk" "$out/aligned.apk"
keystore=$out/debug.keystore
[ -f "$keystore" ] || keytool -genkeypair -keystore "$keystore" -storepass android -keypass android -alias key -dname "CN=fixture" -keyalg RSA -keysize 2048 -validity 3650 >/dev/null 2>&1
"$bt/apksigner" sign --ks "$keystore" --ks-pass pass:android --key-pass pass:android --out "$out/clipboard-fixture.apk" "$out/aligned.apk"
echo "$out/clipboard-fixture.apk"
