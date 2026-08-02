"""
process-approved-logo.py  v3
Accurate crops based on pixel analysis of the 418x418 source image.

Crop zones (source pixel rows, 418px image):
  J swash top:    ~115 (27.5%)
  Script bottom:  ~265 (63.4%)  → script-only wordmark
  Tagline:        ~295-320 (70.6%-76.6%)
  Bird:           ~321-390 (76.8%-93.3%)
  Full logo ends: ~395 (94.5%)
"""
import os, shutil
import numpy as np
from PIL import Image, ImageDraw

SRC = r'C:\Users\yohan\OneDrive\שולחן העבודה\לוגו חנות.png'
OUT = r'C:\Users\yohan\.gemini\antigravity-ide\scratch\custom-ecommerce\frontend\public'

shutil.copy2(SRC, os.path.join(OUT, 'joakim-approved-logo-original.png'))

# Load and upscale 2x
src = Image.open(SRC).convert('RGB')
W, H = src.size  # 418x418
hd  = src.resize((W*2, H*2), Image.LANCZOS)   # 836x836
Wh, Hh = hd.size

# ── Background removal ────────────────────────────────────────────────────────
def remove_bg(img, bg_lum=227.0, ink_lum=15.0, cut=35):
    """
    Luminosity-based alpha. Hard cut below `cut` → fully transparent.
    Higher `cut` removes cream fringe / paper texture halo.
    """
    arr = np.array(img.convert('RGB'), dtype=np.float32)
    r, g, b = arr[:,:,0], arr[:,:,1], arr[:,:,2]
    lum = 0.299*r + 0.587*g + 0.114*b
    raw = np.clip((bg_lum - lum) / (bg_lum - ink_lum) * 255, 0, 255)
    alpha = np.where(raw < cut, 0, raw).astype(np.uint8)
    # Dark ink color — normalize toward near-black
    ink_r = np.clip(r * (alpha/255.0) * 0.4, 0, 60).astype(np.uint8)
    ink_g = np.clip(g * (alpha/255.0) * 0.35, 0, 55).astype(np.uint8)
    ink_b = np.clip(b * (alpha/255.0) * 0.35, 0, 50).astype(np.uint8)
    rgba = np.stack([ink_r, ink_g, ink_b, alpha], axis=2)
    return Image.fromarray(rgba, 'RGBA')

def recolor(img_rgba, rgb):
    arr = np.array(img_rgba)
    out = np.zeros_like(arr)
    out[:,:,0]=rgb[0]; out[:,:,1]=rgb[1]; out[:,:,2]=rgb[2]
    out[:,:,3]=arr[:,:,3]
    return Image.fromarray(out, 'RGBA')

def trim(img, pad=20, thr=12):
    arr = np.array(img); a = arr[:,:,3]
    rows = np.any(a > thr, axis=1); cols = np.any(a > thr, axis=0)
    if not rows.any(): return img
    r0,r1 = np.where(rows)[0][[0,-1]]; c0,c1 = np.where(cols)[0][[0,-1]]
    H2,W2 = arr.shape[:2]
    return img.crop((max(0,c0-pad), max(0,r0-pad),
                     min(W2,c1+pad+1), min(H2,r1+pad+1)))

base_dark  = remove_bg(hd)
CREAM = (241, 236, 226)
base_light = recolor(base_dark, CREAM)

# ── Crop zones (×2 for upscaled coords) ──────────────────────────────────────
# script only (J swash + letters, no tagline)
SC_T = int(Hh * 0.255)   # row 213
SC_B = int(Hh * 0.625)   # row 523  — stop before tagline at 70%

# full logo (script + tagline + bird)
FL_T = int(Hh * 0.245)   # row 205
FL_B = int(Hh * 0.955)   # row 799

def save(img, name):
    p = os.path.join(OUT, name)
    img.save(p)
    print(f'  {name}  {img.size}')
    return img

# Dark-ink variants (for light backgrounds)
full_dark     = trim(base_dark.crop( (0, FL_T, Wh, FL_B)), pad=24)
wordmark_dark = trim(base_dark.crop( (0, SC_T, Wh, SC_B)), pad=18)
save(full_dark,     'joakim-logo-transparent.png')
save(full_dark,     'joakim-logo-full-dark.png')
save(wordmark_dark, 'joakim-wordmark-dark.png')

# Light-ink variants (for dark backgrounds — the site is dark)
full_light     = trim(base_light.crop((0, FL_T, Wh, FL_B)), pad=24)
wordmark_light = trim(base_light.crop((0, SC_T, Wh, SC_B)), pad=18)
save(full_light,     'joakim-logo-full-light.png')
save(wordmark_light, 'joakim-wordmark-light.png')

# Live aliases used by the codebase
wordmark_light.save(os.path.join(OUT, 'joakim-wordmark.png'))
print(f'  joakim-wordmark.png  (alias → wordmark-light)')
full_light.save(os.path.join(OUT, 'joakim-logo.png'))
print(f'  joakim-logo.png      (alias → full-light)')

# ── Favicon — full logo on dark 512×512 square ───────────────────────────────
fav = Image.new('RGBA', (512, 512), (12, 12, 12, 255))
lw, lh = full_light.size
scale = min(420/lw, 420/lh)
lw2, lh2 = int(lw*scale), int(lh*scale)
logo_scaled = full_light.resize((lw2, lh2), Image.LANCZOS)
lx = (512 - lw2) // 2
ly = (512 - lh2) // 2
fav.paste(logo_scaled, (lx, ly), logo_scaled)
save(fav.convert('RGBA'), 'joakim-favicon.png')

# Tiny-size favicon (SVG with italic J — best at 16-32px)
with open(os.path.join(OUT, 'favicon.svg'), 'w', encoding='utf-8') as f:
    f.write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
            '<rect width="100" height="100" rx="14" fill="#0C0C0C"/>'
            '<text x="50" y="68" font-family="Georgia,serif" font-size="62" '
            'font-style="italic" font-weight="700" fill="#F1ECE2" '
            'text-anchor="middle">J</text></svg>')
print('  favicon.svg')

# ── OG image 1200×630 ─────────────────────────────────────────────────────────
og = Image.new('RGBA', (1200, 630), (10, 10, 10, 255))
draw = ImageDraw.Draw(og)
# Subtle vignette
for y in range(315):
    a = int(22 * (1 - y/315))
    draw.line([(0,y),(1200,y)], fill=(255,255,255,a))
draw.line([(60,624),(1140,624)], fill=(200,184,154,100), width=1)

# Full logo centered in 560×420 box
lw, lh = full_light.size
scale = min(560/lw, 420/lh)
lw2, lh2 = int(lw*scale), int(lh*scale)
logo_og = full_light.resize((lw2, lh2), Image.LANCZOS)
og.paste(logo_og, ((1200-lw2)//2, (630-lh2)//2), logo_og)

og.convert('RGB').save(os.path.join(OUT, 'joakim-og.png'), quality=93)
print('  joakim-og.png  1200x630')

print('\nAll variants done.')
