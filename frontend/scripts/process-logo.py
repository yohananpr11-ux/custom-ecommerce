"""
Process the Joakim logo:
 - Remove cream/beige paper background with anti-aliasing preserved
 - Output 1: dark logo on transparent (for light surfaces)
 - Output 2: white logo on transparent (for dark site header/footer)
 - Output 3: 200×200 favicon crop
"""

from PIL import Image, ImageFilter
import numpy as np
import os

SRC = os.path.join(os.path.dirname(__file__), '..', 'public', 'joakim-logo-original.jpg')
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'public')

def remove_background(img_rgba, bg_luminosity=222, ink_luminosity=35):
    """
    Convert luminosity to alpha:
      ink (dark) → alpha 255
      background (bright) → alpha 0
      anti-alias edges → proportional alpha
    Colour is set to black so the logo renders correctly on any background.
    """
    data = np.array(img_rgba, dtype=np.float32)
    r, g, b = data[:, :, 0], data[:, :, 1], data[:, :, 2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b

    span = float(bg_luminosity - ink_luminosity)
    alpha = np.clip((bg_luminosity - lum) / span * 255.0, 0, 255).astype(np.uint8)

    out = np.zeros_like(data, dtype=np.uint8)
    out[:, :, 0] = 0    # R
    out[:, :, 1] = 0    # G
    out[:, :, 2] = 0    # B
    out[:, :, 3] = alpha
    return Image.fromarray(out, 'RGBA')


def invert_to_white(dark_transparent):
    """Flip a dark-on-transparent to white-on-transparent."""
    data = np.array(dark_transparent, dtype=np.uint8)
    result = data.copy()
    result[:, :, 0] = 241   # #F1ECE2 beige-white R
    result[:, :, 1] = 236   # G
    result[:, :, 2] = 226   # B
    # alpha unchanged
    return Image.fromarray(result, 'RGBA')


print('Loading source image…')
src = Image.open(SRC).convert('RGB')

# Up-sample 2x for retina output quality
retina_w = src.width * 2
retina_h = src.height * 2
src_2x = src.resize((retina_w, retina_h), Image.LANCZOS)

src_rgba = src_2x.convert('RGBA')

print('Removing background…')
dark_transparent = remove_background(src_rgba, bg_luminosity=218, ink_luminosity=40)

print('Creating white/cream variant for dark site…')
light_transparent = invert_to_white(dark_transparent)

# ── Outputs ────────────────────────────────────────────────────────
# 1. Light surface: dark logo, transparent bg  (logo-dark.png)
out_dark = os.path.join(OUT_DIR, 'joakim-logo-dark.png')
dark_transparent.save(out_dark, 'PNG', optimize=True)
print(f'Saved: {out_dark}')

# 2. Dark site: cream logo, transparent bg  (joakim-logo.png)
out_light = os.path.join(OUT_DIR, 'joakim-logo.png')
light_transparent.save(out_light, 'PNG', optimize=True)
print(f'Saved: {out_light}')

# 3. Favicon: white-on-dark square, centred on J (100×100 displayed as 32×32)
print('Creating favicon…')
# Crop top portion of the logo (just the script wordmark, skip tagline/bird)
fw, fh = light_transparent.size
crop_top = int(fh * 0.06)
crop_bottom = int(fh * 0.62)    # below script, above tagline
script_crop = light_transparent.crop((0, crop_top, fw, crop_bottom))

# Add square dark canvas
canvas_size = max(script_crop.width, script_crop.height)
fav = Image.new('RGBA', (canvas_size, canvas_size), (10, 10, 10, 255))
px = (canvas_size - script_crop.width) // 2
py = (canvas_size - script_crop.height) // 2
fav.paste(script_crop, (px, py), script_crop)
fav_square = fav.resize((512, 512), Image.LANCZOS)
out_fav = os.path.join(OUT_DIR, 'joakim-favicon.png')
fav_square.save(out_fav, 'PNG', optimize=True)
print(f'Saved: {out_fav}')

# 4. 512×512 OG/SEO image (brand square on dark)
og = Image.new('RGBA', (1200, 630), (10, 10, 10, 255))
# Scale logo to fit width 900 max
aspect = light_transparent.height / light_transparent.width
scaled_w = min(900, light_transparent.width)
scaled_h = int(scaled_w * aspect)
logo_scaled = light_transparent.resize((scaled_w, scaled_h), Image.LANCZOS)
ox = (1200 - scaled_w) // 2
oy = (630 - scaled_h) // 2
og.paste(logo_scaled, (ox, oy), logo_scaled)
out_og = os.path.join(OUT_DIR, 'joakim-og.png')
og.convert('RGB').save(out_og, 'PNG', optimize=True)
print(f'Saved: {out_og}')

print('\nAll done.')
