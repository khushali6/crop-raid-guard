import shutil
import subprocess
from pathlib import Path

import pytest

from app.vision import media

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


def make_video(path: Path, seconds: int = 8) -> Path:
    # A static background for 3 s, then a moving box: motion sampling should keep the moving part.
    subprocess.run([
        "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=green:s=320x240:d={seconds}:r=10",
        "-f", "lavfi", "-i", f"color=c=white:s=24x24:d={seconds}:r=10",
        "-filter_complex", "[0][1]overlay=x='if(gte(t,3),(t-3)*40,-100)':y=100:eval=frame",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path),
    ], check=True)
    return path


def test_probe_extract_and_motion(tmp_path):
    video = make_video(tmp_path / "v.mp4")
    meta = media.probe(video)
    assert 7 <= meta.duration_s <= 9 and meta.width == 320 and meta.codec == "h264"
    frames = media.extract_frames(video, tmp_path / "frames", fps=2)
    assert 14 <= len(frames) <= 18
    media.score_motion(frames)
    still = [f.motion for f in frames if 0.5 < f.t < 2.5]
    moving = [f.motion for f in frames if f.t > 3.5]
    assert max(still) < 0.1 and min(moving) > 0.3  # a 24px box is ~0.75% of the frame
    picked = media.select_frames(frames, threshold=0.3, keepalive_s=10, max_frames=100)
    picked_t = {f.t for f in picked}
    assert not picked_t & {1.0, 1.5, 2.0}  # still middle section skipped
    assert {4.0, 5.0, 6.0} <= picked_t
    clip = media.cut_clip(video, 3, 5, tmp_path / "clip.mp4")
    assert 1.5 <= media.probe(clip).duration_s <= 3


def test_probe_rejects_non_video(tmp_path):
    bad = tmp_path / "x.mp4"
    bad.write_bytes(b"not a video")
    with pytest.raises(media.MediaError):
        media.probe(bad)
