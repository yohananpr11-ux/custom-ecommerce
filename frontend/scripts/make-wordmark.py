from PIL import Image
import numpy as np, os

public = os.path.join(os.path.dirname(__file__), '..', 'public')

src = Image.open(os.path.join(public, 'joakim-logo.png')).convert('RGBA')
w, h = src.size

# Crop: just the script text (~top 7% to 60%), no tagline or bird
top    = int(h * 0.07)
bottom = int(h * 0.60)
wm = src.crop((0, top, w, bottom))

# Trim empty transparent rows and columns
data = np.array(wm)
alpha = data[:, :, 3]
cols = np.where(alpha.max(axis=0) > 10)[0]
rows = np.where(alpha.max(axis=1) > 10)[0]
if len(cols) and len(rows):
    pad = 12
    left   = max(0, cols[0] - pad)
    right  = min(wm.width,  cols[-1] + pad + 1)
    top_r  = max(0, rows[0] - pad)
    bot_r  = min(wm.height, rows[-1] + pad + 1)
    wm = wm.crop((left, top_r, right, bot_r))

out = os.path.join(public, 'joakim-wordmark.png')
wm.save(out, 'PNG', optimize=True)
print(f'Saved {out}  size={wm.size}')
