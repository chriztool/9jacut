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
- `mobile/bridge.js` — the iPhone version of all 23 bridge functions.
- `mobile/mobile.css` — phone-only CSS (safe areas, no tap highlight).
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
2. **Phone layout** — for now the desktop workspace is shown scaled to fit
   (best in landscape).
3. **Captions** — native sherpa-onnx plugin, tiny model by default.
4. **Imported videos are not kept between app launches yet** — reopening a
   saved project asks you to import its videos again.
5. **Signed builds / TestFlight** — needs the Apple Developer account.

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
