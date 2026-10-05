# 9jaCut for iPhone (work in progress)

The iPhone app reuses the desktop interface in `renderer/` unchanged, wrapped
with [Capacitor](https://capacitorjs.com). The desktop app is not affected by
anything here.

## How it fits together

| Desktop (Windows)                         | iPhone                                         |
|-------------------------------------------|------------------------------------------------|
| `renderer/` interface                     | the same `renderer/` interface                 |
| `window.nineJaCut` from `preload.js` + `main.js` | `window.nineJaCut` from `mobile/bridge.js` |
| ffmpeg-static for export & thumbnails     | thumbnails/media info done in the page; export needs a native ffmpeg plugin (next step) |
| sherpa-onnx-node for captions             | not yet (needs a native sherpa-onnx plugin)    |
| Chromium                                  | WebKit (Safari's engine)                        |

- `scripts/build-mobile.js` copies `renderer/` and `assets/` into `www/` and adds the phone bridge.
- `mobile/bridge.js` — the iPhone version of all 25 bridge functions.
- `mobile/phone-layout.js` + `mobile/mobile.css` — the phone editor: player on
  top, timeline below, every PC tool on a rail down the right side. Tool
  panels are "cut open" from the rail by a gold blade line. Pinch the
  timeline to zoom; tap a clip to select it, then drag it or its edges.
  iPads keep the full desktop workspace.
- `ios/` — the Xcode project Capacitor generated (Swift Package Manager, no CocoaPods).
- `.github/workflows/build-ios.yml` — builds on GitHub's Macs, runs it on a simulated iPhone, saves a screenshot.

## What works in this version

Importing videos, music and photos (Photos / Files picker), preview and
timeline playback, thumbnails, media info, every editing tab, stickers, promo
templates, voiceover recording (records MP4/AAC on iPhone), saving and opening
projects (saved to Files > On My iPhone > 9jaCut and the share sheet).

## Not yet

1. **Export** — needs a native ffmpeg plugin using Apple's hardware encoder
   (`h264_videotoolbox`) and an LGPL ffmpeg build. The command builders in
   `clip-export.js` / `promo-export.js` are reused as they are.
2. **Captions** — native sherpa-onnx plugin, tiny model by default.
3. **Imported videos are not kept between app launches yet** — reopening a
   saved project asks you to import its videos again.

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
npm run test:mobile    # check the phone build in Chromium (needs ffmpeg; on Linux use xvfb-run)
```

Building the iPhone app itself needs a Mac — GitHub's are used: push to the
`ios` branch and open the **Actions** tab → **Build iOS app**. The run's
download includes `ios-simulator.png`, a screenshot of 9jaCut running on a
simulated iPhone.
