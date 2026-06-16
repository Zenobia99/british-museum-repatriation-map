#!/usr/bin/env python3
"""Rebuild the photo-disc atlas at higher resolution.

The original atlas packs 5,000 64px thumbnails into 5 x 2048px sheets. The
discs read as low-res because that source is only 64px. We have 384x512 detail
images, so we repack them at 128px into 5 x 4096px sheets — a 4x resolution
jump. The packing (per-object atlas_index, u, v) is preserved exactly from
data/atlas_manifest.json, so the normalised UVs in the app are unchanged and
this is a pure drop-in texture swap.
"""
import json
import os
import sys
from PIL import Image

TILE = 128
SHEET = 4096
N_SHEETS = 5
MANIFEST = "public/data/atlas_manifest.json"
DETAIL_DIR = "/tmp/detail_extract/assets/bm/detail"
OUT = "public/atlas/atlas_{}.jpg"
BG = (18, 19, 23)

manifest = json.load(open(MANIFEST))
tiles = manifest["tiles"]

sheets = [Image.new("RGB", (SHEET, SHEET), BG) for _ in range(N_SHEETS)]
missing = 0
placed = 0

for bm_id, t in tiles.items():
    idx = t["atlas_index"]
    x = round(t["u"] * SHEET)
    y = round(t["v"] * SHEET)
    path = os.path.join(DETAIL_DIR, bm_id + ".jpg")
    if not os.path.exists(path):
        missing += 1
        continue
    try:
        im = Image.open(path).convert("RGB")
    except Exception:
        missing += 1
        continue
    # Center-crop to a square, then downscale to the tile size.
    w, h = im.size
    s = min(w, h)
    left = (w - s) // 2
    top = (h - s) // 2
    im = im.crop((left, top, left + s, top + s)).resize((TILE, TILE), Image.LANCZOS)
    sheets[idx].paste(im, (x, y))
    placed += 1

for i, img in enumerate(sheets):
    img.save(OUT.format(i), quality=88, optimize=True)

print(f"placed={placed} missing={missing}")
print("sheet sizes:")
for i in range(N_SHEETS):
    print(" ", OUT.format(i), os.path.getsize(OUT.format(i)) // 1024, "KB")
