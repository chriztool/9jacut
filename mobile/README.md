# 9jaCut for iPhone (work in progress)

The iPhone app reuses the desktop interface in `renderer/` unchanged, wrapped
with [Capacitor](https://capacitorjs.com). The desktop app is not affected by
anything here.

## How it fits together

| Desktop (Windows)                         | iPhone                                         |
|-------------------------------------------|------------------------------------------------|
| `renderer/` interface                     | the same `renderer/` interface                 |
| `window.nineJaCut` from `preload.js` + `main.js` | `window.nineJaCut` from `mobile/bridge.js` |
| ffmpeg-static for export & thumbnails     | FFmpegKit (our own LGPL build) in `mobile/plugins/native`; thumbnails/media info in the page |
| sherpa-onnx-node for captions             | not yet (needs a native sherpa-onnx plugin)    |
| Chromium                                  | WebKit (Safari's engine)                        |

- `scripts/build-mobile.js` copies `renderer/` and `assets/` into `www/` and adds the phone bridge.
- `mobile/bridge.js` — the iPhone version of all 25 bridge functions.
- `mobile/phone-layout.js` + `mobile/mobile.css` — the phone editor: player on
  top, timeline below, every PC tool on a rail down the right side. Tool
  panels are "cut open" from the rail by a gold blade line. Pinch the
  timeline to zoom; tap a clip to select it, then drag it or its edges.
  iPads keep the full desktop workspace.
- `mobile/export/` — the phone export engine: the desktop's `clip-export.js`
  and `promo-export.js`, bundled (esbuild) with phone stand-ins for `fs`,
  `path`, `crypto` and `child_process`. x264 settings are swapped for Apple's
  hardware encoder (`h264_videotoolbox`). So phone exports match the PC.
- `mobile/plugins/native/` — the Swift plugin (`NineJaCutNative`): runs ffmpeg,
  imports videos/photos/music into the app's Media folder (so they are real
  files and survive restarts), saves exports to Photos.
- `mobile/ffmpeg-ios/build-config.env` + `.github/workflows/build-ffmpeg-ios.yml`
  — builds the App Store-safe FFmpeg (LGPL, freetype for text, VideoToolbox)
  and publishes it as the `ffmpeg-ios-lgpl-*` release. `npm run ios:ffmpeg`
  downloads it into the plugin.
- `ios/` — the Xcode project Capacitor generated (Swift Package Manager, no CocoaPods).
- `.github/workflows/build-ios.yml` — builds on GitHub's Macs, runs an export
  self-test on a simulated iPhone, saves a screenshot, and uploads to TestFlight.

## What works in this version

Importing videos, music and photos (Photos / Files picker), preview and
timeline playback, thumbnails, media info, every editing tab, stickers, promo
templates, voiceover recording (records MP4/AAC on iPhone), saving and opening
projects (saved to Files > On My iPhone > 9jaCut and the share sheet), and
**export**: one video or separate clips, promo videos, saved to Photos with
the share sheet opening afterwards.

## Not yet

1. **Auto-captions** — needs a native sherpa-onnx plugin (tiny model by
   default). Typing captions by hand works.
2. **Long exports in the background** — iOS pauses apps you leave, so stay
   on 9jaCut while a long video exports.

## Getting it on your iPhone (TestFlight)

The `testflight` job in `build-ios.yml` signs the app and uploads it to
TestFlight on every push to `ios`, once these are set up (one time):

1. **App Store Connect > Apps > + > New App**: platform iOS, name 9jaCut,
   bundle ID `com.ninejacut.app` (register it first under
   developer.apple.com > Identifiers if it is not in the list), SKU `9jacut`.
2. **App Store Connect > Users and Access > Integrations > App Store Connect API**:
   create a key with the **Admin** role (it needs to create signing certificates). Download the `.p8` file (only
   possible once) and note the **Key ID** and **Issuer ID**.
3. **GitHub > chriztool/9jacut > Settings > Secrets and variables > Actions**,
   add four secrets:
   - `APPLE_TEAM_ID` — developer.apple.com > Account > Membership details > Team ID
   - `ASC_KEY_ID` — the Key ID
   - `ASC_ISSUER_ID` — the Issuer ID
   - `ASC_KEY_P8` — open the `.p8` file in Notepad and paste all of it
4. Push to `ios` (or re-run the latest **Build iOS app** run). When Apple has
   processed the build, install **TestFlight** from the App Store on your
   iPhone; 9jaCut appears there for you (add yourself under the app's
   TestFlight tab > Internal testing if it doesn't).

## Commands

```
npm install
npm run build:mobile   # build www/
npm run ios:sync       # build www/ and copy it into the Xcode project
npm run ios:ffmpeg     # download the iPhone FFmpeg into the native plugin
npm run test:mobile    # phone layout + bridge in Chromium (needs ffmpeg; on Linux use xvfb-run)
npm run test:mobile-export   # real exports through the phone engine (needs ffmpeg)
npx electron test/mobile-native-test.js   # the iPhone app's path with a stand-in native layer
```

Building the iPhone app itself needs a Mac — GitHub's are used: push to the
`ios` branch and open the **Actions** tab → **Build iOS app**. The run's
download includes `ios-simulator.png`, a screenshot of 9jaCut running on a
simulated iPhone.
