# 9jacut

A Windows desktop app for manually cutting a recording into clips, reframing
them into other aspect ratios for posting online, and mixing in your own
audio. No AI model, no upload — everything runs locally through a bundled
copy of ffmpeg.

## Download (Windows)

**[⬇ Download 9jacut.exe](https://github.com/chriztool/9jacut/releases/latest/download/9jacut.exe)**: one file, nothing to install. Double-click it to start.

The first time, Windows may show "Windows protected your PC" because the app
isn't code-signed yet. Click **More info**, then **Run anyway**.

## What it does

9jaCut is laid out like a professional editor: **tool tabs on the left**,
the **player** in the middle, **Details** for the selected clip on the
right, and a **timeline** along the bottom.

### Timeline
- Import videos in **Media** (or drag files onto the window). The first
  videos you import go straight onto the timeline.
- **Drag clips** to reorder them, **drag a clip's edges** to trim it, press
  **S** (or Ctrl+B) to **split** at the playhead, **Delete** to remove,
  **Ctrl+D** to duplicate. Undo and redo everything (Ctrl+Z / Ctrl+Y).
- Tracks show text and stickers, captions, video and audio (music and
  voiceover) for every clip. Zoom with the slider, Ctrl+scroll or +/−.
- **Space** plays the whole timeline — every clip in order, with its
  speed, look, zoom, text, captions, music and voiceover — so you see
  and hear the finished video before exporting.
- Click a video in Media to preview it on its own; use **Mark In (I)**,
  **Mark Out (O)** and **Enter** to add just that part to the timeline.

### Tool tabs (left)
- **Media** — imported videos; click to preview, + or drag to add.
- **Audio** — import music; put it under one clip or under the **whole
  video** (the song carries on from clip to clip); record a voiceover.
- **Text** — 8 ready-made text styles; click one to add it at the playhead.
- **Stickers** — click to drop a sticker on the clip, then drag it.
- **Effects** — zoom motion, fades and speed presets.
- **Transitions** — crossfade, fade through black, dissolve, slide, wipe,
  circle and more, chosen separately for each pair of clips.
- **Captions** — offline auto-captions (Whisper) for one clip or all
  clips, in 9 languages, plus caption style presets.
- **Filters** — 8 looks with live thumbnails of your clip.
- **Adjust** — brightness, contrast, saturation and video volume.
- **Templates** — set the whole video to TikTok/Reels/Shorts 9:16,
  YouTube 16:9, Instagram 1:1 or 4:5 in one click; open the promo maker.

Most effect tabs act on the selected clip; tick **All clips** to apply to
every clip at once.

### Details (right)
Everything about the selected clip in five tabs — **Video** (name, in/out,
shape and reframe, speed, motion, fades, look, transition to the next
clip), **Audio** (video sound, noise reduction, music, voiceover),
**Text**, **Captions** (edit every line) and **Stickers**. With nothing
selected it shows the project summary.

### Export
**Export** (top right, or Ctrl+E) saves the **whole timeline as one
video** (with transitions) or **each clip as its own file**, at 720p up
to 4K. Reframed clips are cropped exactly as the player shows them, and
text/captions are wrapped to fit the frame exactly as in the preview.

### Also
- **Promo Video** page: 52 styles for business promo videos.
- **About** page: guide, shortcuts, privacy and contact
  (ogemdichris@yahoo.com).
- Save / open projects (Menu or Ctrl+S); older 9jaCut projects still open.
- Everything runs on your computer — no account, no watermark, no upload.

## Where 9jaCut keeps its files

- Captions models: `%APPDATA%\9jacut\caption-models` (delete the folder to
  free the space; it will download again next time you use captions).
- Voiceover recordings: `%APPDATA%\9jacut\voiceovers`.

## Running it (development)

Requires [Node.js](https://nodejs.org) (LTS) installed on Windows.

```
cd 9jacut
npm install
npm start
```

## Tests

```
npm test
```

Generates small test videos and runs every export feature (speed, looks,
text, captions, zoom, fades, music, voiceover, joining with transitions)
through ffmpeg, checking the size and length of each result.

## Building the single shareable .exe

**Automatic:** pushing a version tag (for example `git tag v2.0.1` then
`git push origin v2.0.1`) makes GitHub build `9jacut.exe` on Windows, run
the export tests, and attach the .exe to that release. The Actions tab's
**Run workflow** button does a test build without publishing.

**By hand:**

```
npm install
npm run dist
```

This uses `electron-builder` with the **portable** Windows target — one
self-contained `9jacut.exe` under `dist/`, no installer, no separate files.
Anyone can download that one file and double-click it to run the app. Run
this step **on Windows** — cross-building from another OS needs extra
tooling (Wine) that isn't set up here.

## Notes / known limits

- Preview relies on Chromium's built-in video support. Standard H.264 `.mp4`
  files preview reliably; some `.mov`/`.mkv` files with unusual codecs may not
  preview inline, though export still works regardless.
- The reframe crop is a single position per clip (no animated pan over time).
  Say the word if you'd like the crop to move over the course of a clip and
  I'll add keyframed panning.
- Imported audio is trimmed to the clip's length. If the track is shorter
  than the clip it loops by default; untick *Loop music* to let it end early
  (the rest of the clip is silent instead).
- Text and sticker times are measured on the finished clip, so after a
  speed change they still line up with what you see.
- Cuts re-encode (rather than stream-copy) so start/end points land exactly
  where you set them, at the cost of being a bit slower than a lossless cut.
- Stickers are a fixed size for their whole visible window (no grow/shrink
  or rotation animation) and use a bundled flat-style sticker set rather than
  your system's emoji font, so they render identically on every machine.
- If the source video has no audio track at all, exports now just skip audio
  entirely (or use only your imported audio, if you added one) instead of
  crashing.
- Promo videos are silent (no audio track) and use a fixed crossfade
  slideshow of your photos/clips rather than hand-animated transitions — say
  the word if you'd like background music or extra transition styles added.
- "+ From Loaded Videos" in the Promo tab adds every video currently open in
  the editor; remove any you don't want with the × on that item afterward.

## Project layout

```
9jacut/
  package.json      # electron-builder config (portable .exe target) lives here
  main.js           # Electron main process: file dialogs, ffmpeg export
  preload.js        # safe IPC bridge exposed to the renderer as window.nineJaCut
  promo-templates.js # Promo Video: 4 layouts x 13 themes = 52 named presets
  promo-export.js   # Promo Video: builds/runs the ffmpeg filter graph
  clip-export.js    # Clip Editor export: speed, looks, text, captions, zoom, audio, join
  captions.js       # Auto-captions: model download, speech detection, Whisper
  test/
    export-test.js  # renders real videos through every export feature (npm test)
    ui-v2-harness.js # drives the real app: import, timeline, every tab, captions, export (24 checks)
  build/
    icon.ico        # app icon
  assets/
    stickers/       # bundled PNG sticker set used for the emoji overlay feature
    fonts/          # bundled Poppins font (OFL license) used by Promo Video
  renderer/
    index.html
    style.css       # dark/light theme via CSS variables
    renderer.js     # clip model, undo/redo, effects, captions, voiceover, reframe, stickers, promo, about
    workspace-core.js     # media library, timeline playback engine, source preview
    workspace-timeline.js # timeline tracks, drag to reorder/trim, split/delete/duplicate, zoom
    workspace-panels.js   # left tool tabs (Media … Templates)
    workspace-app.js      # Details panel, Export window, projects, menu, shortcuts, start-up
```
