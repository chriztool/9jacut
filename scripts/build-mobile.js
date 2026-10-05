// Builds the web bundle that the iPhone app (Capacitor) loads, into www/.
//
// The phone app reuses the desktop interface in renderer/ unchanged. The only
// differences are:
//   - mobile/bridge.js provides window.nineJaCut (the desktop gets it from
//     preload.js + main.js; the phone gets it from this file instead).
//   - promo-templates.js is loaded as a plain browser script.
//   - stickers and fonts are copied next to the page.
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

// promo-templates.js is CommonJS; wrap it so it runs as a browser script and
// exposes its exports as window.NineJaCutPromoTemplates.
const promoSrc = fs.readFileSync(path.join(root, 'promo-templates.js'), 'utf8');
fs.writeFileSync(
  path.join(out, 'promo-templates.js'),
  `(function () {\nvar module = { exports: {} };\n${promoSrc}\nwindow.NineJaCutPromoTemplates = module.exports;\n})();\n`
);

let html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
const headExtras = [
  // Temporary: until the phone layout is built, show the full desktop
  // workspace scaled down to fit the screen (best in landscape).
  '<meta name="viewport" content="width=1180, viewport-fit=cover" />',
  '<link rel="stylesheet" href="mobile.css" />',
].join('\n  ');
html = html.replace('<link rel="stylesheet" href="style.css" />', `<link rel="stylesheet" href="style.css" />\n  ${headExtras}`);
const bridgeScripts = [
  `<script>window.NINEJACUT_VERSION = ${JSON.stringify(pkg.version)};</script>`,
  '<script src="promo-templates.js"></script>',
  '<script src="mobile-bridge.js"></script>',
].join('\n  ');
if (!html.includes('<script src="renderer.js"></script>')) {
  throw new Error('renderer/index.html changed: could not find where to add the phone bridge.');
}
html = html.replace('<script src="renderer.js"></script>', `${bridgeScripts}\n  <script src="renderer.js"></script>`);
fs.writeFileSync(path.join(out, 'index.html'), html);

console.log(`Phone web bundle built in ${path.relative(root, out)}/ (version ${pkg.version})`);
