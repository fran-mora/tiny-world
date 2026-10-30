#!/usr/bin/env python3
"""Draw the Tiny World app icon (a little living planet) with Pillow."""
import math, os, random
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'icons')
os.makedirs(OUT, exist_ok=True)
S = 1024
random.seed(7)

def lerp(a, b, t): return a + (b - a) * t
def mix(c1, c2, t): return tuple(int(lerp(a, b, t)) for a, b in zip(c1, c2))

# value noise on a sphere
G = [[[random.random() for _ in range(17)] for _ in range(17)] for _ in range(17)]
def vnoise(x, y, z):
    x, y, z = (x + 2) * 4, (y + 2) * 4, (z + 2) * 4
    xi, yi, zi = int(x), int(y), int(z)
    xf, yf, zf = x - xi, y - yi, z - zi
    s = lambda t: t * t * (3 - 2 * t)
    u, v, w = s(xf), s(yf), s(zf)
    def g(i, j, k): return G[(xi + i) % 17][(yi + j) % 17][(zi + k) % 17]
    x00 = lerp(g(0, 0, 0), g(1, 0, 0), u); x10 = lerp(g(0, 1, 0), g(1, 1, 0), u)
    x01 = lerp(g(0, 0, 1), g(1, 0, 1), u); x11 = lerp(g(0, 1, 1), g(1, 1, 1), u)
    return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w)
def fbm(x, y, z):
    return vnoise(x, y, z) * 0.6 + vnoise(x * 2.1, y * 2.1, z * 2.1) * 0.28 + vnoise(x * 4.3, y * 4.3, z * 4.3) * 0.12

def draw(size_full_bleed=True, pad=0.0):
    img = Image.new('RGB', (S, S), (6, 12, 30))
    px = img.load()
    # background radial gradient
    for y in range(S):
        for x in range(S):
            d = math.hypot(x - S * 0.5, y - S * 0.42) / S
            px[x, y] = mix((28, 54, 98), (4, 8, 20), min(1, d * 1.6))
    # stars
    dr = ImageDraw.Draw(img)
    for _ in range(90):
        x, y = random.randint(0, S), random.randint(0, S)
        r = random.choice([1, 1, 2, 2, 3])
        dr.ellipse([x - r, y - r, x + r, y + r], fill=(200, 220, 255))
    # glow
    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    R = S * (0.33 - pad)
    cx, cy = S / 2, S / 2 + S * 0.01
    gd.ellipse([cx - R * 1.28, cy - R * 1.28, cx + R * 1.28, cy + R * 1.28], fill=(111, 227, 255, 120))
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.06))
    img.paste(glow, (0, 0), glow)
    # planet
    pl = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    pp = pl.load()
    L = (-0.55, -0.6, 0.58)
    ln = math.sqrt(sum(c * c for c in L)); L = tuple(c / ln for c in L)
    for y in range(int(cy - R) - 1, int(cy + R) + 2):
        for x in range(int(cx - R) - 1, int(cx + R) + 2):
            nx, ny = (x - cx) / R, (y - cy) / R
            rr = nx * nx + ny * ny
            if rr > 1: continue
            nz = math.sqrt(1 - rr)
            # rotate for a nicer continent layout
            a = 0.6
            rx = nx * math.cos(a) + nz * math.sin(a); rz = -nx * math.sin(a) + nz * math.cos(a)
            e = fbm(rx * 1.2, ny * 1.2, rz * 1.2)
            light = max(0.0, nx * L[0] + ny * L[1] + nz * L[2])
            shade = 0.28 + 0.85 * light
            if e > 0.53:
                h = (e - 0.53) / 0.3
                col = mix((70, 170, 80), (34, 110, 60), min(1, h * 1.5))
                if h > 0.55: col = mix(col, (120, 110, 95), min(1, (h - 0.55) * 2))
                if abs(ny) > 0.82: col = (235, 244, 250)
                if e < 0.56: col = (214, 196, 140)
            else:
                d = (0.53 - e) / 0.4
                col = mix((40, 150, 160), (18, 60, 120), min(1, d * 1.6))
            col = tuple(min(255, int(c * shade)) for c in col)
            # rim light
            rim = (1 - nz) ** 3
            col = mix(col, (140, 220, 255), rim * 0.6)
            pp[x, y] = col + (255,)
    # tiny tree on top
    td = ImageDraw.Draw(pl)
    tx, ty = cx - R * 0.08, cy - R * 0.98
    td.rectangle([tx - R * 0.025, ty - R * 0.06, tx + R * 0.025, ty + R * 0.06], fill=(92, 62, 40, 255))
    for k, (w, hh) in enumerate([(0.2, 0.16), (0.16, 0.14), (0.11, 0.12)]):
        yy = ty - R * (0.05 + k * 0.1)
        td.ellipse([tx - R * w, yy - R * hh, tx + R * w, yy + R * hh * 0.6], fill=(80 + k * 20, 200 + k * 10, 120 + k * 15, 255))
    pl = pl.filter(ImageFilter.SMOOTH)
    img.paste(pl, (0, 0), pl)
    return img

big = draw(pad=0.0)
big.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, 'icon-512.png'))
big.resize((192, 192), Image.LANCZOS).save(os.path.join(OUT, 'icon-192.png'))
big.resize((180, 180), Image.LANCZOS).save(os.path.join(OUT, 'apple-touch-icon.png'))
mask = draw(pad=0.07)
mask.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, 'maskable-512.png'))
print('icons written')
