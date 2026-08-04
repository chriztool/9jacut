// Promo Video template system: a handful of true base layouts combined with
// color themes to produce 50+ named, selectable presets. This keeps the
// system easy to maintain/expand (add one layout or one theme and every
// combination is generated automatically) rather than hand-building 50+
// bespoke one-off animations.

const COLOR_THEMES = [
  { key: 'golden', name: 'Golden Hour', bg: '#2a1508', accent: '#d7a86e', text: '#f5ead9' },
  { key: 'crimson', name: 'Crimson Nights', bg: '#3a0f12', accent: '#e2555f', text: '#fbeceb' },
  { key: 'ocean', name: 'Ocean Breeze', bg: '#082635', accent: '#4fc3d9', text: '#eaf7fa' },
  { key: 'emerald', name: 'Emerald Forest', bg: '#0e2b1c', accent: '#4fbd7d', text: '#eafaf1' },
  { key: 'royal', name: 'Royal Purple', bg: '#241033', accent: '#a97bdb', text: '#f3ecfa' },
  { key: 'sunset', name: 'Sunset Coral', bg: '#3a1610', accent: '#f2895a', text: '#fdf1ea' },
  { key: 'midnight', name: 'Midnight Navy', bg: '#0a1730', accent: '#6f9ceb', text: '#eaf1fd' },
  { key: 'blush', name: 'Blush Pink', bg: '#3a1524', accent: '#f0a3c4', text: '#fdeef4' },
  { key: 'mint', name: 'Minty Fresh', bg: '#0d2b28', accent: '#57d9b8', text: '#e9faf6' },
  { key: 'charcoal', name: 'Charcoal Mono', bg: '#1c1c1c', accent: '#d9d9d9', text: '#f5f5f5' },
  { key: 'lavender', name: 'Lavender Dream', bg: '#241f3a', accent: '#b8a9e8', text: '#f2effa' },
  { key: 'amber', name: 'Amber Glow', bg: '#331d05', accent: '#e8a839', text: '#fbeed9' },
  { key: 'berry', name: 'Berry Bold', bg: '#33082a', accent: '#e35fb0', text: '#fbe8f4' },
];

const BASE_LAYOUTS = [
  { key: 'hero', name: 'Hero Card', description: 'Full-frame photo/video with a bold info card at the bottom.' },
  { key: 'split', name: 'Split Panel', description: 'Media fills the top, a solid info card with all your details sits below.' },
  { key: 'spotlight', name: 'Spotlight Grid', description: 'A framed, bordered spotlight of your photos/videos centered between your business info.' },
  { key: 'strip', name: 'Side Strip', description: 'A tall media strip on one side, your info listed beside it.' },
];

function buildPresetList() {
  const presets = [];
  for (const layout of BASE_LAYOUTS) {
    for (const theme of COLOR_THEMES) {
      presets.push({
        id: `${layout.key}__${theme.key}`,
        name: `${theme.name} ${layout.name}`,
        layout: layout.key,
        layoutName: layout.name,
        layoutDescription: layout.description,
        theme: theme.key,
        themeName: theme.name,
        swatch: theme.accent,
        bg: theme.bg,
      });
    }
  }
  return presets;
}

function getThemeByKey(key) {
  return COLOR_THEMES.find((t) => t.key === key) || COLOR_THEMES[0];
}

function getLayoutByKey(key) {
  return BASE_LAYOUTS.find((l) => l.key === key) || BASE_LAYOUTS[0];
}

module.exports = { COLOR_THEMES, BASE_LAYOUTS, buildPresetList, getThemeByKey, getLayoutByKey };
