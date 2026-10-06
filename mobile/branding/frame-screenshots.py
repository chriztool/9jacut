"""Turns the raw app screens (screenshots.js) into App Store screenshots:
brand background, a headline, and the app screen with rounded corners.
Output is 1320 x 2868 (iPhone 6.9").

    python3 mobile/branding/frame-screenshots.py RAW_DIR OUT_DIR
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

raw, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
here = os.path.dirname(os.path.abspath(__file__))
fonts = os.path.join(here, '..', '..', 'assets', 'fonts')
bold = ImageFont.truetype(os.path.join(fonts, 'Poppins-Bold.ttf'), 96)
sub = ImageFont.truetype(os.path.join(fonts, 'Poppins-Medium.ttf'), 50)

SHOTS = [
    ('raw-1-editor.png', 'Edit videos like a pro', 'A real timeline, right on your phone'),
    ('raw-2-rail.png', 'Tools, one swipe away', 'Swipe in from the edge for the tools'),
    ('raw-3-filters.png', 'Looks that pop', 'Naija Gold, Cinematic, Vintage and more'),
    ('raw-4-text.png', 'Titles in one tap', 'Bold styles for TikTok, Reels and Status'),
    ('raw-5-transitions.png', 'Smooth transitions', 'Crossfade, slide, wipe, circle open…'),
    ('raw-6-promo.png', 'Business promo videos', '52 styles. Add your photos and go'),
    ('raw-7-export.png', 'Free. No watermark.', 'Export up to 4K straight to Photos'),
]

W, H = 1320, 2868
top, bottom = (0x3a, 0x22, 0x12), (0x14, 0x0c, 0x07)
for i, (name, title, subtitle) in enumerate(SHOTS, 1):
    bg = Image.new('RGB', (W, H))
    grad = Image.linear_gradient('L').resize((W, H))
    bg = Image.composite(Image.new('RGB', (W, H), bottom), Image.new('RGB', (W, H), top), grad)
    d = ImageDraw.Draw(bg)
    y = 150
    for text, font, fill, gap in [(title, bold, (0xf2, 0xc4, 0x6a), 30), (subtitle, sub, (0xf3, 0xe6, 0xd6), 0)]:
        # Wrap long headlines onto two lines.
        words, lines, line = text.split(), [], ''
        for w in words:
            test = (line + ' ' + w).strip()
            if d.textlength(test, font=font) > W - 160 and line:
                lines.append(line)
                line = w
            else:
                line = test
        lines.append(line)
        for ln in lines:
            d.text(((W - d.textlength(ln, font=font)) / 2, y), ln, font=font, fill=fill)
            y += font.size + 22
        y += gap
    shot = Image.open(os.path.join(raw, name)).convert('RGB')
    scale = 0.80
    sw, sh = int(shot.width * scale), int(shot.height * scale)
    shot = shot.resize((sw, sh), Image.LANCZOS)
    x0, y0 = (W - sw) // 2, max(y + 60, H - sh - 90)
    if y0 + sh > H - 40:  # keep the bottom of the phone screen visible
        y0 = H - sh - 40
    mask = Image.new('L', (sw, sh), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, sw - 1, sh - 1], radius=70, fill=255)
    shadow = Image.new('L', (W, H), 0)
    ImageDraw.Draw(shadow).rounded_rectangle([x0, y0 + 20, x0 + sw, y0 + sh + 20], radius=70, fill=170)
    bg = Image.composite(Image.new('RGB', (W, H), (0, 0, 0)), bg, shadow.filter(ImageFilter.GaussianBlur(40)))
    border = Image.new('RGB', (sw + 16, sh + 16), (0x86, 0x56, 0x33))
    bmask = Image.new('L', (sw + 16, sh + 16), 0)
    ImageDraw.Draw(bmask).rounded_rectangle([0, 0, sw + 15, sh + 15], radius=78, fill=255)
    bg.paste(border, (x0 - 8, y0 - 8), bmask)
    bg.paste(shot, (x0, y0), mask)
    dest = os.path.join(out, f'{i:02d}-{name[6:]}')
    bg.save(dest)
    print(dest, bg.size)
