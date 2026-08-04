# 9jacut

A Windows desktop app for manually cutting a recording into clips, reframing
them into other aspect ratios for posting online, and mixing in your own
audio. No AI model, no upload — everything runs locally through a bundled
copy of ffmpeg.

## What it does

- Open a local `.mp4` / `.mov` / `.mkv` / `.avi` file, or just drag a video
  file onto the window.
- Scrub the timeline, hit **Mark In** / **Mark Out** (duration shows live),
  then **+ Add Clip** to build a list of clips. Rename clips and hand-edit
  their start/end times directly.
- Pick an aspect ratio per clip: **Original**, **Vertical 9:16**, **Square 1:1**,
  **Portrait 4:5**, or **Custom** (type any W:H ratio). Click **Reframe** to drag
  the crop box over the frame and choose what stays in shot, then **Done**.
- **Add Audio** on any clip to import a local audio file (anything you already
  have downloaded/exported — the app can't pull tracks directly from Spotify
  or other streaming services, since they don't allow that) and mix it under
  the clip with a volume slider, or check **Replace original audio** to swap
  it out entirely.
- **😀 Stickers** on any clip: pick a smiley/reaction from the picker, drag it
  anywhere on the frame, and set when it appears/disappears. Baked into the
  exported video, and correctly follows the frame if the clip is also
  reframed to a different aspect ratio.
- **Undo** reverses the last change — adding/deleting a clip, edits, reframe
  drags, audio changes, sticker placement.
- Switch between dark and light mode with the button in the top-right (dark
  brown is the default).
- Choose an export folder and hit **Export All Clips** — each one is cut and
  (if reframed) cropped/scaled with ffmpeg, saved as `<name>_<aspect>.mp4`.
- **Multiple videos per session**: open or drag in more than one source video;
  a row of pills lets you switch which one is active, and every clip
  remembers which video it came from (including on export).
- **Clip thumbnails**, a **Duplicate** button per clip, and full **Save
  Project** / **Load Project** (writes/reads a `.json` project file covering
  every loaded video, clip, crop, audio, and sticker) so you can pick up a
  project later without redoing anything.
- **Promo Video tab** (top of the window): a separate "CapCut-style" business
  promo maker. Fill in your business name/tagline/hours/address/contact, add
  photos and/or video clips (either from files or straight from whatever's
  loaded in the Clip Editor), then pick one of **52 named styles** — 4 base
  layouts (Hero Card, Split Panel, Spotlight Grid, Side Strip) × 13 color
  themes — and export a vertical 9:16 promo video with your info baked in.

## Running it (development)

Requires [Node.js](https://nodejs.org) (LTS) installed on Windows.

```
cd 9jacut
npm install
npm start
```

## Building the single shareable .exe

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
- Imported audio is trimmed to the clip's length (or looped/padded isn't done
  automatically — if your track is shorter than the clip, it'll just end
  early). Let me know if you'd like it to loop instead.
- Keyboard shortcuts (space to play/pause, I/O to mark in/out, Ctrl+Z, etc.)
  are intentionally not wired up yet — planned for later.
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
  Clip Editor; remove any you don't want with the × on that item afterward.

## Project layout

```
9jacut/
  package.json      # electron-builder config (portable .exe target) lives here
  main.js           # Electron main process: file dialogs, ffmpeg export
  preload.js        # safe IPC bridge exposed to the renderer as window.nineJaCut
  promo-templates.js # Promo Video: 4 layouts x 13 themes = 52 named presets
  promo-export.js   # Promo Video: builds/runs the ffmpeg filter graph
  build/
    icon.ico        # app icon
  assets/
    stickers/       # bundled PNG sticker set used for the emoji overlay feature
    fonts/          # bundled Poppins font (OFL license) used by Promo Video
  renderer/
    index.html
    style.css       # dark/light theme via CSS variables
    renderer.js     # UI logic: timeline, clips, reframe drag, undo, audio, stickers, export, promo
```
