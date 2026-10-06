#!/usr/bin/env bash
# Downloads 9jaCut's iPhone FFmpeg (built by .github/workflows/build-ffmpeg-ios.yml)
# into the native plugin. Run from the repo root: npm run ios:ffmpeg
set -euo pipefail
cd "$(dirname "$0")/.."
source mobile/ffmpeg-ios/build-config.env
REPO="${GITHUB_REPOSITORY:-chriztool/9jacut}"
DEST=mobile/plugins/native/ios
STAMP="$DEST/Frameworks/.release"

if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$FFMPEG_IOS_RELEASE" ]; then
  echo "FFmpeg for iPhone ($FFMPEG_IOS_RELEASE) is already here."
  exit 0
fi

TMP=$(mktemp -d)
URL="https://github.com/$REPO/releases/download/$FFMPEG_IOS_RELEASE"
echo "Downloading $FFMPEG_IOS_RELEASE from $REPO..."
if ! curl -fsSL "$URL/ffmpeg-ios.zip" -o "$TMP/ffmpeg-ios.zip"; then
  echo "Could not download $URL/ffmpeg-ios.zip."
  echo "It is made by the 'Build FFmpeg for iOS' GitHub workflow; check it has finished."
  exit 1
fi
curl -fsSL "$URL/ffmpeg-ios.zip.sha256" -o "$TMP/sum"
(cd "$TMP" && shasum -a 256 -c sum)

rm -rf "$DEST/Frameworks" "$DEST/Sources/FFmpegKit" "$DEST/Sources/CFFmpegBridge"
mkdir -p "$DEST/Frameworks" "$TMP/x"
unzip -q "$TMP/ffmpeg-ios.zip" -d "$TMP/x"
cp -R "$TMP/x/Frameworks/"*.xcframework "$DEST/Frameworks/"
cp -R "$TMP/x/Sources/FFmpegKit" "$TMP/x/Sources/CFFmpegBridge" "$DEST/Sources/"
cp "$TMP/x/BUILD-INFO.txt" "$DEST/Frameworks/" 2>/dev/null || true
echo "$FFMPEG_IOS_RELEASE" > "$STAMP"
rm -rf "$TMP"
echo "FFmpeg for iPhone is ready ($FFMPEG_IOS_RELEASE)."
