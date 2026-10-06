// Builds the web bundle that the iPhone app (Capacitor) loads, into www/.
//
// The phone app reuses the desktop interface in renderer/ unchanged. The only
// differences are:
//   - mobile/bridge.js provides window.nineJaCut (the desktop gets it from
//     preload.js + main.js; the phone gets it from this file instead).
//   - promo-templates.js is loaded as a plain browser script.
//   - stickers and fonts are copied next to the page.
//   - mobile/phone-layout.js + mobile/mobile.css turn the workspace into the
//     phone editor (tool rail on the side, panels that slide out of it).
//
// Run: npm run build:mobile   (then: npx cap sync ios)

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'www');
const pkg = require(path.join(root, 'package.json'));

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

fs.rmSync(out, { recursive: true, force: true });
copyDir(path.join(root, 'renderer'), out);
copyDir(path.join(root, 'assets'), path.join(out, 'assets'));
fs.copyFileSync(path.join(root, 'mobile', 'bridge.js'), path.join(out, 'mobile-bridge.js'));
fs.copyFileSync(path.join(root, 'mobile', 'mobile.css'), path.join(out, 'mobile.css'));
fs.copyFileSync(path.join(root, 'mobile', 'phone-layout.js'), path.join(out, 'phone-layout.js'));

// style.css points at ../assets/ (renderer/ sits next to assets/ on desktop);
// in www/ the assets folder is beside the page.
const cssPath = path.join(out, 'style.css');
fs.writeFileSync(cssPath, fs.readFileSync(cssPath, 'utf8').split('../assets/').join('assets/'));

// promo-templates.js is CommonJS; wrap it so it runs as a browser script and
// exposes its exports as window.NineJaCutPromoTemplates.
const promoSrc = fs.readFileSync(path.join(root, 'promo-templates.js'), 'utf8');
fs.writeFileSync(
  path.join(out, 'promo-templates.js'),
  `(function () {\nvar module = { exports: {} };\n${promoSrc}\nwindow.NineJaCutPromoTemplates = module.exports;\n})();\n`
);

let html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
const headExtras = [
  // Phones get the phone layout (mobile/phone-layout.js); iPads get the
  // desktop workspace at their real width.
  '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />',
  '<link rel="stylesheet" href="mobile.css" />',
].join('\n  ');
html = html.replace('<link rel="stylesheet" href="style.css" />', `<link rel="stylesheet" href="style.css" />\n  ${headExtras}`);
const bridgeScripts = [
  `<script>window.NINEJACUT_VERSION = ${JSON.stringify(pkg.version)};</script>`,
  '<script src="promo-templates.js"></script>',
  '<script src="mobile-export.js"></script>',
  '<script src="mobile-bridge.js"></script>',
].join('\n  ');
if (!html.includes('<script src="renderer.js"></script>')) {
  throw new Error('renderer/index.html changed: could not find where to add the phone bridge.');
}
html = html.replace('<script src="renderer.js"></script>', `${bridgeScripts}\n  <script src="renderer.js"></script>`);
if (!html.includes('<script src="workspace-app.js"></script>')) {
  throw new Error('renderer/index.html changed: could not find where to add the phone layout.');
}
html = html.replace('<script src="workspace-app.js"></script>', '<script src="workspace-app.js"></script>\n  <script src="phone-layout.js"></script>');
fs.writeFileSync(path.join(out, 'index.html'), html);

// The phone export engine: the desktop's clip-export.js / promo-export.js,
// bundled with phone stand-ins for fs, path, crypto and child_process
// (mobile/export/shims.js), exposed as window.NineJaCutExport.
const NODE_MODULES = ['fs', 'path', 'crypto', 'child_process'];
require('esbuild').buildSync({
  absWorkingDir: root,
  entryPoints: ['mobile/export/entry.js'],
  outfile: path.join(out, 'mobile-export.js'),
  bundle: true,
  format: 'iife',
  globalName: 'NineJaCutExport',
  platform: 'browser',
  target: ['safari15'],
  legalComments: 'none',
  logLevel: 'warning',
  alias: Object.fromEntries(NODE_MODULES.map((m) => [m, `./mobile/export/node/${m}.js`])),
});

console.log(`Phone web bundle built in ${path.relative(root, out)}/ (version ${pkg.version})`);
