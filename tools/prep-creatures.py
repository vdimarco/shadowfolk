"""Trim Higgsfield creature art to its visible pixels and save small WebP files for the game.

Run: python3 -I tools/prep-creatures.py <dir-with-pngs> public/creatures
Prints each file's size and aspect, for src/game/creature-art.ts.
"""
import sys
from pathlib import Path
from PIL import Image

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
dst.mkdir(parents=True, exist_ok=True)
ids = ['moth', 'hare', 'crocodile', 'dog', 'bird', 'deer', 'fox', 'butterfly', 'owl', 'spider', 'wolf']
for cid in ids:
    p = src / f'{cid}.png'
    if not p.exists():
        print('missing', cid)
        continue
    im = Image.open(p).convert('RGBA')
    # keep the soft glow: trim to pixels that are at least faintly visible
    a = im.getchannel('A').point(lambda v: 255 if v > 6 else 0)
    box = a.getbbox()
    im = im.crop(box)
    w, h = im.size
    pad = int(max(w, h) * 0.03)
    out = Image.new('RGBA', (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    out.paste(im, (pad, pad))
    s = 640 / max(out.size)
    out = out.resize((max(1, round(out.size[0] * s)), max(1, round(out.size[1] * s))), Image.LANCZOS)
    f = dst / f'{cid}.webp'
    out.save(f, 'WEBP', quality=88, method=6)
    print(f'{cid}: {out.size[0]}x{out.size[1]} aspect {out.size[0] / out.size[1]:.3f} {f.stat().st_size // 1024} KB')
