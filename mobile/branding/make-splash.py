"""Draws the 9jaCut launch screen: the app icon centred on the app's dark
background (#111111, as in capacitor.config.json).

    python3 mobile/branding/make-splash.py ICON_ROUNDED.png OUT.png
"""
import sys
from PIL import Image
icon = Image.open(sys.argv[1]).convert('RGBA')
W = 2732
img = Image.new('RGBA', (W, W), (0x11, 0x11, 0x11, 255))
s = 520
icon = icon.resize((s, s), Image.LANCZOS)
img.alpha_composite(icon, ((W - s) // 2, (W - s) // 2))
img.convert('RGB').save(sys.argv[2])
print(sys.argv[2])
