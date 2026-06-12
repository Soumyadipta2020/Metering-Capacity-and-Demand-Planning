from __future__ import annotations

import math
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
OUTPUT = ROOT / "abc_smart_meter_demo_3min.mp4"

WIDTH = 1280
HEIGHT = 720
FPS = 24
TOTAL_SECONDS = 180


def _add_temp_deps() -> None:
    deps = Path(tempfile.gettempdir()) / "codex_video_deps"
    if deps.exists():
        sys.path.insert(0, str(deps))


_add_temp_deps()

try:
    import imageio_ffmpeg
except ImportError as exc:
    raise SystemExit(
        "Missing imageio-ffmpeg. Install it into the temp dependency folder first:\n"
        "python -m pip install --target %TEMP%\\codex_video_deps imageio-ffmpeg"
    ) from exc


FONT_DIR = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"


def font(name: str, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = {
        "regular": ["segoeui.ttf", "arial.ttf"],
        "bold": ["segoeuib.ttf", "arialbd.ttf"],
        "semibold": ["seguisb.ttf", "arialbd.ttf"],
    }.get(name, ["segoeui.ttf"])
    for candidate in candidates:
        p = FONT_DIR / candidate
        if p.exists():
            return ImageFont.truetype(str(p), size=size)
    return ImageFont.load_default()


FONT_TITLE = font("bold", 44)
FONT_H1 = font("bold", 34)
FONT_H2 = font("semibold", 24)
FONT_BODY = font("regular", 22)
FONT_SMALL = font("regular", 16)
FONT_TINY = font("regular", 13)


def load_image(name: str) -> Image.Image:
    p = ASSETS / name
    if not p.exists():
        raise FileNotFoundError(p)
    return Image.open(p).convert("RGB")


def cover(img: Image.Image, progress: float, zoom: float = 1.035) -> Image.Image:
    base_scale = max(WIDTH / img.width, HEIGHT / img.height)
    scale = base_scale * (1 + (zoom - 1) * progress)
    new_size = (math.ceil(img.width * scale), math.ceil(img.height * scale))
    resized = img.resize(new_size, Image.Resampling.LANCZOS)
    max_x = max(0, resized.width - WIDTH)
    max_y = max(0, resized.height - HEIGHT)
    x = int(max_x * (0.20 + 0.60 * progress))
    y = int(max_y * (0.15 + 0.45 * progress))
    return resized.crop((x, y, x + WIDTH, y + HEIGHT))


def round_rect(draw: ImageDraw.ImageDraw, xy, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def text(draw: ImageDraw.ImageDraw, xy, value: str, fnt, fill):
    draw.text(xy, value, font=fnt, fill=fill)


def draw_caption(frame: Image.Image, scene_no: int, title: str, subtitle: str, seconds: float) -> Image.Image:
    overlay = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    bar_h = 126
    y0 = HEIGHT - bar_h
    d.rectangle((0, y0, WIDTH, HEIGHT), fill=(11, 27, 32, 198))
    d.rectangle((0, y0, WIDTH, y0 + 3), fill=(18, 184, 174, 230))

    pill = f"{scene_no:02d}"
    round_rect(d, (40, y0 + 32, 98, y0 + 84), 16, fill=(20, 184, 174, 255))
    tw = d.textlength(pill, font=FONT_H2)
    text(d, (40 + (58 - tw) / 2, y0 + 43), pill, FONT_H2, (255, 255, 255, 255))

    text(d, (122, y0 + 28), title, FONT_H1, (255, 255, 255, 255))
    text(d, (122, y0 + 74), subtitle, FONT_BODY, (210, 230, 232, 255))

    time_label = f"{int(seconds // 60):02d}:{int(seconds % 60):02d} / 03:00"
    text(d, (WIDTH - 172, y0 + 84), time_label, FONT_SMALL, (210, 230, 232, 255))

    progress_w = WIDTH - 80
    progress = max(0.0, min(1.0, seconds / TOTAL_SECONDS))
    d.rectangle((40, HEIGHT - 12, 40 + progress_w, HEIGHT - 8), fill=(78, 100, 104, 255))
    d.rectangle((40, HEIGHT - 12, 40 + int(progress_w * progress), HEIGHT - 8), fill=(27, 206, 193, 255))
    return Image.alpha_composite(frame.convert("RGBA"), overlay).convert("RGB")


def intro_frame(progress: float, seconds: float) -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT), (8, 25, 31))
    px = img.load()
    for y in range(HEIGHT):
        for x in range(WIDTH):
            nx = x / WIDTH
            ny = y / HEIGHT
            pulse = 0.5 + 0.5 * math.sin((nx * 5.0 + progress * 2.0) * math.pi)
            r = int(8 + 12 * ny + 10 * pulse)
            g = int(26 + 50 * nx + 20 * pulse)
            b = int(34 + 40 * (1 - ny) + 16 * pulse)
            px[x, y] = (r, g, b)

    layer = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    for i in range(18):
        x = int((i * 96 + progress * 260) % (WIDTH + 160)) - 80
        d.line((x, 0, x - 260, HEIGHT), fill=(36, 212, 197, 38), width=2)
    for y in range(80, HEIGHT, 76):
        alpha = 28 + int(20 * math.sin(progress * math.tau + y * 0.01))
        d.line((0, y, WIDTH, y), fill=(255, 255, 255, alpha), width=1)

    cards = [
        ("Requests", "233k", 100, 420),
        ("Booked", "32.6k", 340, 470),
        ("Risk", "8.6k", 580, 420),
        ("Engineers", "300", 820, 470),
        ("Margin", "2.1%", 1060, 420),
    ]
    for idx, (label, val, x, y) in enumerate(cards):
        bob = int(12 * math.sin(progress * math.tau + idx))
        round_rect(d, (x, y + bob, x + 150, y + 88 + bob), 18, fill=(255, 255, 255, 36), outline=(36, 212, 197, 110), width=1)
        text(d, (x + 18, y + 16 + bob), label.upper(), FONT_TINY, (191, 231, 229, 235))
        text(d, (x + 18, y + 38 + bob), val, FONT_H2, (255, 255, 255, 255))

    round_rect(d, (64, 62, 186, 184), 30, fill=(21, 184, 174, 255))
    text(d, (92, 102), "ABC", FONT_H2, (255, 255, 255, 255))
    text(d, (220, 72), "ABC Smart Meter", FONT_TITLE, (255, 255, 255, 255))
    text(d, (220, 126), "Capacity and Demand Planning Platform", FONT_H1, (214, 242, 240, 255))
    text(d, (224, 190), "3-minute product demo", FONT_BODY, (178, 215, 218, 255))
    text(d, (224, 232), "15-second branded background intro", FONT_SMALL, (245, 212, 128, 255))

    img = Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")
    return draw_caption(img, 1, "Opening background", "The demo starts with a 15-second branded background segment.", seconds)


def outro_frame(progress: float, seconds: float) -> Image.Image:
    bg = cover(load_image("01_journey_overview.png"), progress, zoom=1.01).filter(ImageFilter.GaussianBlur(4))
    shade = Image.new("RGBA", (WIDTH, HEIGHT), (4, 19, 24, 172))
    frame = Image.alpha_composite(bg.convert("RGBA"), shade)
    d = ImageDraw.Draw(frame)
    text(d, (92, 240), "ABC Smart Meter Planning", FONT_TITLE, (255, 255, 255, 255))
    text(d, (96, 304), "Demo complete", FONT_H1, (27, 206, 193, 255))
    text(d, (96, 356), "Appointments, risk, capacity, meter history, and scenario impact in one workspace.", FONT_BODY, (220, 236, 238, 255))
    return draw_caption(frame.convert("RGB"), 10, "Ready for walkthrough", "Use this MP4 as the app demo artifact.", seconds)


SCENES = [
    {"kind": "intro", "duration": 15},
    {
        "image": "01_journey_overview.png",
        "duration": 18,
        "title": "Executive appointment journey",
        "subtitle": "Track requests, dialler load, bookings, cancellations, aborts, and successful executions.",
    },
    {
        "image": "02_journey_detail.png",
        "duration": 18,
        "title": "Journey trend and decomposition",
        "subtitle": "Expose where appointment volume converts, drops, or needs operational attention.",
    },
    {
        "image": "03_dialler_performance.png",
        "duration": 18,
        "title": "Dialler performance",
        "subtitle": "Review contact slots, channel volume, conversion, and performance signals by period.",
    },
    {
        "image": "04_risk_recovery.png",
        "duration": 18,
        "title": "Risk and recovery",
        "subtitle": "Surface cancellation and same-day abort drivers before they become lost capacity.",
    },
    {
        "image": "05_planning_shortterm.png",
        "duration": 18,
        "title": "Short-term resource planning",
        "subtitle": "Balance engineer availability, region load, and near-term appointment demand.",
    },
    {
        "image": "06_planning_detail.png",
        "duration": 18,
        "title": "Capacity grid detail",
        "subtitle": "Scan utilisation, remaining slots, and pressure points across the roster horizon.",
    },
    {
        "kind": "dual",
        "start_image": "07_meter_lookup_start.png",
        "end_image": "08_meter_lookup_results.png",
        "duration": 18,
        "title": "Single meter view",
        "subtitle": "Search an MPXN and consolidate meter, MOP, DC, and visit history for the agent.",
    },
    {
        "image": "09_financial_builder.png",
        "duration": 18,
        "title": "Scenario builder",
        "subtitle": "Adjust volume, success, cancellation, revenue, cost, and engineer assumptions.",
    },
    {
        "image": "10_financial_results.png",
        "duration": 18,
        "title": "Scenario impact",
        "subtitle": "Translate operational changes into revenue, cost, margin, and capacity status.",
    },
    {"kind": "outro", "duration": 3},
]


def frame_for_scene(scene: dict, progress: float, scene_no: int, seconds: float) -> Image.Image:
    kind = scene.get("kind", "image")
    if kind == "intro":
        return intro_frame(progress, seconds)
    if kind == "outro":
        return outro_frame(progress, seconds)
    if kind == "dual":
        a = cover(load_image(scene["start_image"]), min(progress * 1.6, 1.0), zoom=1.018)
        b = cover(load_image(scene["end_image"]), progress, zoom=1.025)
        if progress < 0.32:
            base = a
        elif progress > 0.45:
            base = b
        else:
            alpha = (progress - 0.32) / 0.13
            base = Image.blend(a, b, alpha)
    else:
        base = cover(load_image(scene["image"]), progress, zoom=1.025)
    return draw_caption(base, scene_no, scene["title"], scene["subtitle"], seconds)


def render_video() -> None:
    durations = [s["duration"] for s in SCENES]
    total = sum(durations)
    if total != TOTAL_SECONDS:
        raise ValueError(f"Scene durations add to {total}, expected {TOTAL_SECONDS}")

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    cmd = [
        ffmpeg,
        "-y",
        "-f",
        "rawvideo",
        "-vcodec",
        "rawvideo",
        "-s",
        f"{WIDTH}x{HEIGHT}",
        "-pix_fmt",
        "rgb24",
        "-r",
        str(FPS),
        "-i",
        "-",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "21",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        str(OUTPUT),
    ]

    process = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    assert process.stdin is not None

    global_frame = 0
    scene_no = 1
    for scene in SCENES:
        frames = int(scene["duration"] * FPS)
        for i in range(frames):
            progress = i / max(1, frames - 1)
            seconds = global_frame / FPS
            frame = frame_for_scene(scene, progress, scene_no, seconds)
            process.stdin.write(frame.tobytes())
            global_frame += 1
        if scene.get("kind") not in {"intro", "outro"}:
            scene_no += 1
        elif scene.get("kind") == "intro":
            scene_no += 1

    process.stdin.close()
    stderr = process.stderr.read().decode("utf-8", errors="replace") if process.stderr else ""
    rc = process.wait()
    if rc:
        raise RuntimeError(f"ffmpeg failed with exit code {rc}\n{stderr[-4000:]}")

    frames, secs = imageio_ffmpeg.count_frames_and_secs(str(OUTPUT))
    print(f"Wrote {OUTPUT}")
    print(f"Frames: {frames}")
    print(f"Duration: {secs:.2f}s")
    print(f"Size: {OUTPUT.stat().st_size / (1024 * 1024):.1f} MB")


if __name__ == "__main__":
    render_video()
