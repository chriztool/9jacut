"""Draws the 9jaCut app icon (the desktop icon's design) at any size.

The desktop build/icon.ico is only 256 px with rounded white corners; the
App Store needs a sharp, square, opaque 1024 px image (iOS rounds the corners
itself). Same shapes and colours, redrawn from the design.

    python3 mobile/branding/make-icon.py OUT.png [SIZE] [--rounded]
"""
import sys
from PIL import Image, ImageDraw, ImageFilter

out = sys.argv[1]
size = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else 1024
rounded = '--rounded' in sys.argv
S = 4  # supersampling for smooth edges
W = size * S
u = W / 256.0  # design units: the original 256 px icon

def P(x, y):
    return (x * u, y * u)

# Background: warm brown, lighter at the top left (#845532 -> #4e2f17).
top, bottom = (0x86, 0x56, 0x33), (0x4e, 0x2f, 0x17)
# Diagonal blend: t = (x + y) / 2, top-left -> bottom-right.
n = 256
ramp = Image.new('L', (n, n))
ramp.putdata([min(255, (x + y) // 2) for y in range(n) for x in range(n)])
grad = ramp.resize((W, W), Image.BILINEAR)
img = Image.composite(Image.new('RGB', (W, W), bottom), Image.new('RGB', (W, W), top), grad).convert('RGBA')

def layer(draw_fn):
    """Draws semi-transparent shapes on their own layer, then blends it in."""
    global img
    over = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(over))
    img = Image.alpha_composite(img, over)

# Thin gold inner frame.
layer(lambda d: d.rounded_rectangle([P(12, 12), P(244, 244)], radius=40 * u, outline=(0xd2, 0x9b, 0x5e, 190), width=int(1.4 * u)))

# Corner dots (sprocket holes), faint.
def dots(d):
    for cx, cy in [(30, 29), (45, 29), (30, 44), (226, 29), (226, 212), (211, 227), (30, 225)]:
        r = 2.4 * u
        d.ellipse([cx * u - r, cy * u - r, cx * u + r, cy * u + r], fill=(255, 255, 255, 34))
layer(dots)
d = ImageDraw.Draw(img)

WHITE = (255, 255, 255, 255)
# The two film-strip rails of the "H".
d.rounded_rectangle([P(74, 59), P(92, 194)], radius=3 * u, fill=WHITE)
d.rounded_rectangle([P(164, 59), P(182, 194)], radius=3 * u, fill=WHITE)

# The two slanted rungs.
def rung(x1, y1, x2, y2, t):
    import math
    dx, dy = x2 - x1, y2 - y1
    L = math.hypot(dx, dy)
    nx, ny = -dy / L * t / 2, dx / L * t / 2
    pts = [P(x1 + nx, y1 + ny), P(x2 + nx, y2 + ny), P(x2 - nx, y2 - ny), P(x1 - nx, y1 - ny)]
    d.polygon(pts, fill=WHITE)
    for (x, y) in [(x1, y1), (x2, y2)]:
        r = t / 2 * u
        d.ellipse([x * u - r, y * u - r, x * u + r, y * u + r], fill=WHITE)
rung(73, 109, 184, 95, 12)
rung(73, 157, 184, 145, 12)

# Gold play button with a dark outline and a soft shadow.
tri = [P(110, 95), P(110, 160), P(166, 127)]
shadow = Image.new('RGBA', (W, W), (0, 0, 0, 0))
ImageDraw.Draw(shadow).polygon([(x + 2 * u, y + 3 * u) for x, y in tri], fill=(30, 15, 5, 120))
img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(3 * u)))
gold = Image.linear_gradient('L').resize((W, W))
gold_fill = Image.composite(Image.new('RGBA', (W, W), (0xd8, 0x9e, 0x45, 255)), Image.new('RGBA', (W, W), (0xf2, 0xc4, 0x6a, 255)), gold)
mask = Image.new('L', (W, W), 0)
ImageDraw.Draw(mask).polygon(tri, fill=255)
img.paste(gold_fill, (0, 0), mask)
d = ImageDraw.Draw(img)
d.line(tri + [tri[0]], fill=(0x3d, 0x22, 0x10, 255), width=int(3.2 * u), joint='curve')

# Sound bars, soft white.
def bars(d):
    for x, h in [(60, 11), (70, 16), (80, 13), (90, 21), (171, 21), (181, 13), (191, 15), (201, 10)]:
        d.rounded_rectangle([P(x, 220 - h), P(x + 4, 220)], radius=1.5 * u, fill=(255, 255, 255, 120))
layer(bars)

img = img.resize((size, size), Image.LANCZOS)
if rounded:
    m = Image.new('L', (size * S, size * S), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size * S - 1, size * S - 1], radius=int(size * S * 0.18), fill=255)
    img.putalpha(m.resize((size, size), Image.LANCZOS))
    img.save(out)
else:
    img.convert('RGB').save(out)  # App Store icons must have no transparency
print(f'{out}: {size}x{size}')
