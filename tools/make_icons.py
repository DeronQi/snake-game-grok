#!/usr/bin/env python3
"""生成贪吃蛇 PWA 图标：192、512，以及可遮罩的 512。重复执行会覆盖旧文件。"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "icons"


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def draw_icon(size, maskable):
    image = Image.new("RGB", (size, size), (5, 8, 15))
    draw = ImageDraw.Draw(image)
    margin = 0.2 if maskable else 0.1
    left = size * margin
    top = size * margin
    span = size * (1 - 2 * margin)

    def center(gx, gy):
        return (
            left + (gx + 0.5) / 7 * span,
            top + (gy + 0.5) / 7 * span,
        )

    body = [
        (1, 4), (2, 4), (3, 4), (4, 4), (5, 4),
        (5, 3), (5, 2), (4, 2), (3, 2), (2, 2),
        (2, 1), (3, 1),
    ]
    radius = span / 7 * 0.46
    tail = (16, 110, 78)
    head = (186, 255, 154)
    last = len(body) - 1
    for index, cell in enumerate(body):
        color = lerp(tail, head, index / last)
        x, y = center(*cell)
        pad = radius * (0.82 if index < last else 1)
        draw.ellipse((x - pad, y - pad, x + pad, y + pad), fill=color)
    hx, hy = center(*body[-1])
    eye = max(2, int(size * 0.012))
    for side in (-1, 1):
        ex = hx + radius * 0.28
        ey = hy + side * radius * 0.34
        draw.ellipse((ex - eye, ey - eye, ex + eye, ey + eye), fill=(12, 28, 22))

    ax, ay = center(5.15, 0.85)
    ar = radius * 1.05
    draw.ellipse((ax - ar, ay - ar, ax + ar, ay + ar), fill=(255, 59, 92))
    draw.ellipse(
        (ax - ar * 0.15, ay - ar * 1.45, ax + ar * 0.72, ay - ar * 0.45),
        fill=(54, 196, 112),
    )
    return image


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    draw_icon(192, False).save(OUT / "icon-192.png", "PNG")
    draw_icon(512, False).save(OUT / "icon-512.png", "PNG")
    draw_icon(512, True).save(OUT / "icon-maskable-512.png", "PNG")
    print("wrote", OUT / "icon-192.png")
    print("wrote", OUT / "icon-512.png")
    print("wrote", OUT / "icon-maskable-512.png")


if __name__ == "__main__":
    main()
