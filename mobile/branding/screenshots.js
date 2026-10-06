// Makes the App Store screenshots: the real phone build (www/) at iPhone
// 6.9" size (440 x 956 points @3x = 1320 x 2868 px), with demo videos.
//
//   npm run build:mobile
//   xvfb-run -a npx electron --no-sandbox mobile/branding/screenshots.js OUT_DIR
//
// Writes raw-*.png (the app screen). mobile/branding/frame-screenshots.py
// then adds the headline and background.

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

app.commandLine.appendSwitch('force-device-scale-factor', '3');
app.on('window-all-closed', () => {});

const root = path.join(__dirname, '..', '..');
const outDir = path.resolve(process.argv[process.argv.length - 1]);
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FF = process.env.FFMPEG_BIN || 'ffmpeg';

// Colourful demo footage (no third-party content).
function makeVideos() {
  const vids = [
    ['Lagos sunset.mp4', 'gradients=s=1080x1920:r=30:d=8:speed=0.015:c0=0xff7a18:c1=0xaf002d:c2=0x3b0a45:c3=0xffd23f:nb_colors=4'],
    ['Market day.mp4', 'gradients=s=1080x1920:r=30:d=6:speed=0.02:c0=0x008751:c1=0x3ddc84:c2=0x0b3d2e:c3=0xf2c46a:nb_colors=4'],
    ['Owambe.mp4', 'mandelbrot=s=1080x1920:r=30:start_scale=2.5:end_scale=0.6:outer=normalized_iteration_count'],
  ];
  return vids.map(([name, src]) => {
    const file = path.join(outDir, name);
    if (!fs.existsSync(file)) {
      execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', src, '-f', 'lavfi', '-i', 'sine=frequency=330:duration=8',
        '-t', name === 'Owambe.mp4' ? '5' : '8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file]);
    }
    return { name, b64: fs.readFileSync(file).toString('base64') };
  });
}

app.whenReady().then(async () => {
  const videos = makeVideos();
  const win = new BrowserWindow({
    width: 440, height: 956, show: true, useContentSize: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await win.loadURL(`${require('url').pathToFileURL(path.join(root, 'www', 'index.html')).href}?phone=1`);
  await sleep(1500);
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const shoot = async (name) => {
    await sleep(900);
    const img = await win.webContents.capturePage();
    const size = img.getSize();
    fs.writeFileSync(path.join(outDir, name), img.toPNG());
    console.log(`[shots] ${name} ${size.width}x${size.height}`);
  };

  // Import the demo videos through the real Import button.
  await js(`(() => {
    const files = ${JSON.stringify(videos)}.map(({ name, b64 }) => {
      const bin = atob(b64); const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new File([bytes], name, { type: 'video/mp4' });
    });
    const realClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this.type !== 'file') return realClick.call(this);
      const dt = new DataTransfer(); for (const f of files) dt.items.add(f);
      this.files = dt.files; setTimeout(() => this.dispatchEvent(new Event('change')), 0);
    };
    document.getElementById('btnOpenVideo').click();
  })()`);
  await sleep(6000);
  await js(`window.nineJaCutPhone.closeSheet()`);
  await js(`document.getElementById('projectName').value = 'Owambe weekend'`);

  // Vertical, a look, a title and a sticker on the first clip.
  await js(`(() => {
    for (const c of state.clips) c.aspect = 'vertical';
    const c = state.clips[0];
    c.look = { ...c.look, preset: 'gold' };
    selectClip(c.id);
    addTextPreset({ name: 'Headline', text: 'OWAMBE VIBES', style: 'outline', color: '#ffd23f', size: 11, position: 'top' });
    if (typeof addStickerToSelectedClip === 'function') addStickerToSelectedClip('fire');
    c.transitionOut = { type: 'fade', duration: 0.5 };
    renderClipList(); renderTimeline(); updatePreviewFx();
  })()`).catch((e) => console.log('[shots] setup:', e.message));
  await sleep(800);
  await js(`document.getElementById('tlFit').click()`);
  await js(`(() => { const v = document.getElementById('preview'); v.currentTime = 2.2; })()`);
  await shoot('raw-1-editor.png');

  // The tool rail, with Filters open.
  await js(`window.nineJaCutPhone.openRail()`);
  await sleep(500);
  await shoot('raw-2-rail.png');
  await js(`document.querySelector('#phoneRail [data-tab="filters"]').click()`);
  await sleep(2500);
  await shoot('raw-3-filters.png');

  await js(`document.querySelector('#phoneRail [data-tab="text"]').click()`);
  await sleep(800);
  await shoot('raw-4-text.png');

  await js(`document.querySelector('#phoneRail [data-tab="transitions"]').click()`);
  await sleep(800);
  await shoot('raw-5-transitions.png');
  await js(`window.nineJaCutPhone.closeSheet()`);

  // Promo videos.
  await js(`document.getElementById('tabPromoVideo').click()`);
  await sleep(1500);
  await js(`(() => {
    const set = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
    set('promoName', "Mama Bola's Kitchen"); set('promoTagline', 'Jollof wey sweet pass'); set('promoHours', 'Mon–Sun 8am–10pm');
    set('promoAddress', '12 Allen Avenue, Ikeja'); set('promoContact', 'IG: @mamabola');
  })()`);
  await sleep(800);
  await shoot('raw-6-promo.png');

  // Export.
  await js(`document.getElementById('tabClipEditor').click()`);
  await sleep(800);
  await js(`openExportDialog()`);
  await sleep(800);
  await shoot('raw-7-export.png');
  app.exit(0);
}).catch((e) => { console.error(e); app.exit(1); });
