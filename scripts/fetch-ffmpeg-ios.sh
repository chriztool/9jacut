#!/usr/bin/env bash
# Downloads 9jaCut's iPhone FFmpeg (built by .github/workflows/build-ffmpeg-ios.yml)
# into the native plugin. Run from the repo root: npm run ios:ffmpeg
set -euo pipefail
cd "$(dirname "$0")/.."
source mobile/ffmpeg-ios/build-config.env
REPO="${GITHUB_REPOSITORY:-chriztool/9jacut}"
DEST=mobile/plugins/native/ios
STAMP="$DEST/Frameworks/.release"

# The bridge passes every ffmpeg log message to Swift, even debug ones, because
# a custom av_log callback has to do its own level check (av_log_default_callback
# normally does it). On a phone that floods memory during exports, so skip
# messages above the current log level (normally "info").
patch_bridge() {
  local f="$DEST/Sources/CFFmpegBridge/CFFmpegBridge.c"
  grep -q 'fks_log_level_ok' "$f" && return 0
  python3 - "$f" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
anchor = "    if (execution == NULL || execution->log_callback == NULL) {\n        return;\n    }\n"
assert anchor in s, 'CFFmpegBridge.c changed: could not add the log level check'
check = anchor + """    if (!fks_log_level_ok(level)) {
        return;
    }
"""
helper = """typedef int (*fks_get_log_level_function)(void);

/* av_log hands custom callbacks every message; keep only those at or below the current level. */
static int fks_log_level_ok(int level) {
    static fks_get_log_level_function get_level = NULL;
    if (get_level == NULL) {
        get_level = (fks_get_log_level_function)fks_symbol("av_log_get_level");
    }
    int current = get_level != NULL ? get_level() : 32; /* AV_LOG_INFO */
    return (level & 0xff) <= current;
}

static void fks_log("""
s = s.replace(anchor, check, 1).replace("static void fks_log(", helper, 1)
open(p, 'w').write(s)
PY
  echo "Patched the FFmpeg bridge to respect the log level."
}

if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$FFMPEG_IOS_RELEASE" ]; then
  echo "FFmpeg for iPhone ($FFMPEG_IOS_RELEASE) is already here."
  patch_bridge
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
patch_bridge
echo "FFmpeg for iPhone is ready ($FFMPEG_IOS_RELEASE)."
