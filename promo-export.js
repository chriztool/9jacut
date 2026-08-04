const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const CANVAS_W = 1080;
const CANVAS_H = 1920;
const OVERLAP = 0.6;

// ffmpeg's filtergraph parser has fragile quoting for inline text='...'
// values (apostrophes, colons and commas in a business name/address can
// break the whole graph). Writing each line to a small temp file and
// referencing it with textfile=<path> sidesteps that entirely - arbitrary
// text just works with zero escaping needed for the text content itself.
function writeTextFile(tmpDir, text) {
  fs.mkdirSync(tmpDir, { recursive: true });
  const fileName = `t-${crypto.randomBytes(6).toString('hex')}.txt`;
  const filePath = path.join(tmpDir, fileName);
  fs.writeFileSync(filePath, String(text == null ? '' : text), 'utf8');
  return filePath;
}

// File PATHS still need escaping for the filtergraph itself (Windows drive
// letters contain a colon, and backslashes are the filter escape char).
function escFontPath(p) {
  return String(p).replace(/\\/g, '/').replace(/:/g, '\\:');
}

function getLayoutGeometry(layoutKey) {
  switch (layoutKey) {
    case 'hero':
      return { media: { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H }, textAlign: 'left', textX: 72, textStartY: 1260, titleSize: 62, taglineSize: 32, bodySize: 28 };
    case 'split':
      return { media: { x: 0, y: 0, w: CANVAS_W, h: 1150 }, textAlign: 'left', textX: 72, textStartY: 1230, titleSize: 62, taglineSize: 32, bodySize: 28 };
    case 'spotlight':
      return { media: { x: 90, y: 470, w: 900, h: 900 }, textAlign: 'center', textX: null, textStartY: 130, bottomTextStartY: 1430, titleSize: 56, taglineSize: 30, bodySize: 27 };
    case 'strip':
      return { media: { x: 0, y: 0, w: 540, h: CANVAS_H }, textAlign: 'left', textX: 610, textStartY: 300, titleSize: 38, taglineSize: 24, bodySize: 22 };
    default:
      return getLayoutGeometry('hero');
  }
}

// Builds the -filter_complex string for one promo render. `items` is a list
// of { filePath, type: 'image'|'video' } in display order; they play as an
// equal-length crossfading reel inside the layout's media rect. Whatever
// canvas area isn't covered by the media rect is already the theme's
// background color (input 0 is a full-canvas color source), so solid info
// cards need no extra drawbox - only 'hero' (full-bleed media) needs a
// translucent scrim, and 'spotlight' needs an accent border around its box.
function buildFilterComplex({ items, layout, theme, business, durationPerItem, fonts, tmpDir }) {
  const geo = getLayoutGeometry(layout);
  const n = items.length;
  const perItem = Math.max(1, durationPerItem || 3);
  const overlap = n > 1 ? Math.min(OVERLAP, perItem - 0.2) : 0;
  const totalDuration = n > 0 ? (perItem * n - overlap * (n - 1)) : perItem;

  const chains = [];
  const mw = geo.media.w;
  const mh = geo.media.h;

  items.forEach((item, i) => {
    const idx = i + 1;
    chains.push(`[${idx}:v]scale=${mw}:${mh}:force_original_aspect_ratio=increase,crop=${mw}:${mh},setsar=1,fps=30,format=yuv420p[m${i}]`);
  });

  let mergedLabel = 'm0';
  if (n === 1) {
    chains.push(`[m0]null[mfinal]`);
    mergedLabel = 'mfinal';
  } else {
    // Each xfade's offset must be measured against the *merged* stream's own
    // running duration (which shrinks by `overlap` at every transition), not
    // the raw sum of individual clip lengths - otherwise later transitions
    // land early and the whole reel truncates short.
    let mergedDuration = perItem;
    for (let i = 1; i < n; i++) {
      const offset = Math.max(0, mergedDuration - overlap);
      const outLabel = i === n - 1 ? 'mfinal' : `mx${i}`;
      chains.push(`[${mergedLabel}][m${i}]xfade=transition=fade:duration=${overlap.toFixed(2)}:offset=${offset.toFixed(2)}[${outLabel}]`);
      mergedLabel = outLabel;
      mergedDuration = mergedDuration + perItem - overlap;
    }
  }

  let baseLabel = '0:v';
  if (layout === 'spotlight') {
    const bx = geo.media.x - 8, by = geo.media.y - 8, bw = geo.media.w + 16, bh = geo.media.h + 16;
    chains.push(`[0:v]drawbox=x=${bx}:y=${by}:w=${bw}:h=${bh}:color=${theme.accent}@1.0:t=8[boxed]`);
    baseLabel = 'boxed';
  }

  chains.push(`[${baseLabel}][mfinal]overlay=${geo.media.x}:${geo.media.y}:shortest=1[ov]`);
  let workingLabel = 'ov';

  if (layout === 'hero') {
    chains.push(`[ov]drawbox=x=0:y=1180:w=${CANVAS_W}:h=740:color=${theme.bg}@0.55:t=fill[scrim]`);
    workingLabel = 'scrim';
  }

  const xExprCenter = '(w-text_w)/2';
  let y = geo.textStartY;
  const textFilters = [];
  const addLine = (text, fontPath, size, color, gapAfter) => {
    if (!text) return;
    const xExpr = geo.textAlign === 'center' ? xExprCenter : String(geo.textX);
    const txtFile = writeTextFile(tmpDir, text);
    textFilters.push(`drawtext=fontfile=${escFontPath(fontPath)}:textfile=${escFontPath(txtFile)}:fontcolor=${color}:fontsize=${size}:x=${xExpr}:y=${y}`);
    y += size + (gapAfter != null ? gapAfter : 16);
  };

  addLine(business.name, fonts.bold, geo.titleSize, theme.accent, 12);
  addLine(business.tagline, fonts.medium, geo.taglineSize, theme.text, Math.round(geo.titleSize * 0.5));
  if (geo.bottomTextStartY != null) y = geo.bottomTextStartY;
  addLine(business.hours, fonts.regular, geo.bodySize, theme.text, 10);
  addLine(business.address, fonts.regular, geo.bodySize, theme.text, 10);
  addLine(business.contact, fonts.regular, geo.bodySize, theme.accent, 10);

  textFilters.forEach((f, i) => {
    const outLabel = i === textFilters.length - 1 ? 'vout' : `t${i}`;
    chains.push(`[${workingLabel}]${f}[${outLabel}]`);
    workingLabel = outLabel;
  });
  if (!textFilters.length) {
    chains.push(`[${workingLabel}]null[vout]`);
  }

  return {
    filterComplex: chains.join(';'),
    totalDuration,
    colorArg: `color=c=${theme.bg}:s=${CANVAS_W}x${CANVAS_H}:d=${totalDuration.toFixed(2)}:r=30`,
  };
}

function runPromoExport({ ffmpegPath, items, layout, theme, business, durationPerItem, fonts, tmpDir, outPath }, onProgress) {
  return new Promise((resolve, reject) => {
    let built;
    try {
      built = buildFilterComplex({ items, layout, theme, business, durationPerItem, fonts, tmpDir });
    } catch (err) {
      reject(err);
      return;
    }
    const { filterComplex, totalDuration, colorArg } = built;

    const inputs = ['-f', 'lavfi', '-i', colorArg];
    for (const item of items) {
      if (item.type === 'image') {
        inputs.push('-loop', '1', '-t', String(durationPerItem || 3), '-i', item.filePath);
      } else {
        inputs.push('-t', String(durationPerItem || 3), '-i', item.filePath);
      }
    }

    const args = [
      '-y',
      ...inputs,
      '-filter_complex', filterComplex,
      '-map', '[vout]',
      '-t', String(totalDuration),
      '-r', '30',
      '-pix_fmt', 'yuv420p',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '19',
      outPath,
    ];

    const ff = spawn(ffmpegPath, args);
    let stderrBuf = '';

    ff.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString();
      const match = stderrBuf.match(/time=(\d+):(\d+):(\d+\.\d+)/g);
      if (match) {
        const last = match[match.length - 1];
        const m = last.match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (m) {
          const elapsed = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
          const percent = Math.min(100, Math.round((elapsed / totalDuration) * 100));
          onProgress(percent);
        }
      }
    });

    ff.on('error', (err) => reject(err));
    ff.on('close', (code) => {
      if (code === 0) resolve({ outPath, totalDuration });
      else reject(new Error(`ffmpeg exited with code ${code}\n${stderrBuf.slice(-800)}`));
    });
  });
}

module.exports = {
  buildFilterComplex,
  runPromoExport,
  getLayoutGeometry,
  escFontPath,
  writeTextFile,
  CANVAS_W,
  CANVAS_H,
};
