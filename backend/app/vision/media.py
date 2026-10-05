"""ffmpeg helpers: probing, motion-aware frame sampling and clip cutting."""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image


@dataclass
class VideoMeta:
    duration_s: float
    fps: float
    width: int
    height: int
    codec: str
    creation_time: datetime | None
    container: str


@dataclass
class Frame:
    index: int
    t: float
    path: Path
    motion: float = 0.0


class MediaError(RuntimeError):
    pass


def _run(cmd: list[str], timeout: int = 900) -> subprocess.CompletedProcess:
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise MediaError(proc.stderr.strip().splitlines()[-1] if proc.stderr.strip() else "ffmpeg failed")
    return proc


def probe(path: Path) -> VideoMeta:
    out = _run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)], 120)
    data = json.loads(out.stdout or "{}")
    video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    if not video:
        raise MediaError("This file has no video stream.")
    fmt = data.get("format", {})
    duration = float(fmt.get("duration") or video.get("duration") or 0)
    num, _, den = (video.get("avg_frame_rate") or "0/1").partition("/")
    fps = float(num) / float(den or 1) if float(den or 1) else 0.0
    created = (fmt.get("tags") or {}).get("creation_time") or (video.get("tags") or {}).get("creation_time")
    creation_time = None
    if created:
        try:
            creation_time = datetime.fromisoformat(created.replace("Z", "+00:00"))
        except ValueError:
            creation_time = None
    if duration <= 0:
        raise MediaError("Could not read the video duration.")
    return VideoMeta(duration, fps, int(video.get("width") or 0), int(video.get("height") or 0),
                     video.get("codec_name", ""), creation_time, fmt.get("format_name", ""))


def extract_frames(path: Path, out_dir: Path, fps: float, max_width: int = 1280) -> list[Frame]:
    out_dir.mkdir(parents=True, exist_ok=True)
    _run([
        "ffmpeg", "-v", "error", "-y", "-i", str(path),
        "-vf", f"fps={fps},scale='min({max_width},iw)':-2",
        "-q:v", "3", str(out_dir / "f_%06d.jpg"),
    ])
    files = sorted(out_dir.glob("f_*.jpg"))
    return [Frame(i, round(i / fps, 3), f) for i, f in enumerate(files)]


def _small_gray(path: Path) -> np.ndarray:
    with Image.open(path) as im:
        return np.asarray(im.convert("L").resize((160, 90)), dtype=np.float32)


def score_motion(frames: list[Frame], pixel_delta: float = 12.0) -> None:
    """Motion = percentage of pixels whose brightness changed by more than ``pixel_delta``.

    A whole-frame mean would dilute a small, distant animal into sensor noise.
    """
    prev: np.ndarray | None = None
    for fr in frames:
        cur = _small_gray(fr.path)
        fr.motion = 100.0 if prev is None else float(np.mean(np.abs(cur - prev) > pixel_delta) * 100)
        prev = cur


def select_frames(frames: list[Frame], threshold: float, keepalive_s: float, max_frames: int) -> list[Frame]:
    """Keep frames with motion, their neighbours, and a periodic keepalive; cap the total uniformly."""
    if not frames:
        return []
    keep: set[int] = set()
    last_kept_t = -1e9
    for i, fr in enumerate(frames):
        if fr.motion >= threshold:
            keep.update({max(i - 1, 0), i, min(i + 1, len(frames) - 1)})
        if fr.t - last_kept_t >= keepalive_s:
            keep.add(i)
            last_kept_t = fr.t
    selected = [frames[i] for i in sorted(keep)]
    if len(selected) > max_frames:
        step = len(selected) / max_frames
        selected = [selected[int(k * step)] for k in range(max_frames)]
    return selected


def cut_clip(path: Path, start: float, end: float, out: Path, max_width: int = 1280) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    duration = max(end - start, 1.0)
    _run([
        "ffmpeg", "-v", "error", "-y", "-ss", f"{max(start, 0):.2f}", "-i", str(path), "-t", f"{duration:.2f}",
        "-vf", f"scale='min({max_width},iw)':-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", str(out),
    ])
    return out


def transcode_web(path: Path, out: Path) -> Path:
    """Re-encode to H.264 MP4 so every browser can play the original upload."""
    _run([
        "ffmpeg", "-v", "error", "-y", "-i", str(path), "-vf", "scale='min(1280,iw)':-2", "-c:v", "libx264",
        "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", str(out),
    ], timeout=1800)
    return out
