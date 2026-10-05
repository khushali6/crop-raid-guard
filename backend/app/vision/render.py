"""Keyframe rendering: detection overlay and privacy blur for people."""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from app.vision.detector import Detection


def _px(bbox, w: int, h: int) -> tuple[int, int, int, int]:
    x, y, bw, bh = bbox
    return int(x * w), int(y * h), int((x + bw) * w), int((y + bh) * h)


def render_keyframe(frame: Path, highlight: tuple[float, float, float, float], label: str, people: list[Detection]) -> bytes:
    with Image.open(frame) as src:
        im = src.convert("RGB")
    w, h = im.size
    for person in people:
        box = _px(person.bbox, w, h)
        if box[2] > box[0] and box[3] > box[1]:
            region = im.crop(box).filter(ImageFilter.GaussianBlur(radius=max(8, (box[2] - box[0]) // 6)))
            im.paste(region, box)
    draw = ImageDraw.Draw(im)
    x1, y1, x2, y2 = _px(highlight, w, h)
    stroke = max(2, w // 400)
    draw.rectangle((x1, y1, x2, y2), outline=(250, 248, 240), width=stroke)
    try:
        font = ImageFont.load_default(size=max(14, w // 60))
    except TypeError:
        font = ImageFont.load_default()
    tb = draw.textbbox((0, 0), label, font=font)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    ty = max(0, y1 - th - 12)
    draw.rectangle((x1, ty, x1 + tw + 14, ty + th + 10), fill=(46, 79, 58))
    draw.text((x1 + 7, ty + 4), label, fill=(250, 248, 240), font=font)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=85)
    return buf.getvalue()


def thumbnail(frame: Path, max_width: int = 640) -> bytes:
    with Image.open(frame) as src:
        im = src.convert("RGB")
    im.thumbnail((max_width, max_width))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=80)
    return buf.getvalue()
