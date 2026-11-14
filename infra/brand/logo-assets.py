"""Regenerates the TavetaHQ logo files under Frontend/public/ from the brand
handoff PNGs (the source of truth for the artwork).

    python3 infra/brand/logo-assets.py /path/to/design_handoff_tavetahq_brand/assets

Needs Pillow. Inputs used: TavetaHQ-bird-transparent-1024.png and
TavetaHQ-logo-transparent.png. Outputs:

  brand/tavetahq-mark.png         bird, trimmed, 128 px: the in-app mark (16-40 px)
  brand/tavetahq-bird-512.png     bird with the handoff's padding: avatars, social
  brand/tavetahq-logo.png         full lockup with the tagline, trimmed
  brand/tavetahq-wordmark.png     bird + wordmark, tagline removed, trimmed
  brand/tavetahq-email-logo.png   the wordmark at 2x its 168 px email width
  favicon.ico, favicon-32.png, apple-touch-icon.png, icon-192.png, icon-512.png

The bird is never recoloured. Icons that the OS may show on any background
(apple-touch, PWA) sit on a white tile; the rest stay transparent.
"""

import sys
from pathlib import Path

from PIL import Image

src = Path(sys.argv[1]) if len(sys.argv) > 1 else None
if not src or not (src / "TavetaHQ-bird-transparent-1024.png").exists():
    sys.exit(__doc__)

public = Path(__file__).resolve().parents[2] / "Frontend" / "public"
brand = public / "brand"
brand.mkdir(parents=True, exist_ok=True)

bird = Image.open(src / "TavetaHQ-bird-transparent-1024.png").convert("RGBA")
lockup = Image.open(src / "TavetaHQ-logo-transparent.png").convert("RGBA")


def trim(im: Image.Image) -> Image.Image:
    return im.crop(im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox())


def square(im: Image.Image, size: int, pad: float, bg=(0, 0, 0, 0)) -> Image.Image:
    """Centre a trimmed image on a square canvas with `pad` (0-0.5) on its long side."""
    inner = round(size * (1 - 2 * pad))
    scale = inner / max(im.size)
    art = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), bg)
    canvas.alpha_composite(art, ((size - art.width) // 2, (size - art.height) // 2))
    return canvas


def save(im: Image.Image, path: Path) -> None:
    im.save(path, optimize=True)
    print(f"{path.relative_to(public.parent)}  {im.width}x{im.height}  {path.stat().st_size} B")


tight = trim(bird)
white = (255, 255, 255, 255)

save(square(tight, 128, 0.02), brand / "tavetahq-mark.png")
save(bird.resize((512, 512), Image.LANCZOS), brand / "tavetahq-bird-512.png")
save(trim(lockup), brand / "tavetahq-logo.png")

# The tagline sits right of the bird, below the wordmark (x >= 250, y >= 219 in
# the 949 x 295 lockup); clear it and trim to get the bird + wordmark alone.
wordmark = lockup.copy()
wordmark.paste((0, 0, 0, 0), (250, 219, wordmark.width, wordmark.height))
wordmark = trim(wordmark)
save(wordmark, brand / "tavetahq-wordmark.png")
email_w = 336
save(
    wordmark.resize((email_w, round(wordmark.height * email_w / wordmark.width)), Image.LANCZOS),
    brand / "tavetahq-email-logo.png",
)

save(square(tight, 32, 0.0), public / "favicon-32.png")
square(tight, 256, 0.0).save(public / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
print("Frontend/public/favicon.ico  16/32/48")
save(square(tight, 180, 0.14, white).convert("RGB"), public / "apple-touch-icon.png")
save(square(tight, 192, 0.14, white).convert("RGB"), public / "icon-192.png")
save(square(tight, 512, 0.14, white).convert("RGB"), public / "icon-512.png")
