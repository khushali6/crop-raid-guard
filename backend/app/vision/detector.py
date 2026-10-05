"""Detection + classification backends.

`SpeciesNetBackend` runs Google's SpeciesNet ensemble (MegaDetector + species classifier +
geofence) on sampled frames. `MockBackend` produces deterministic output for tests and CI.
"""

from __future__ import annotations

import json
import logging
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

log = logging.getLogger(__name__)


@dataclass
class Detection:
    label: str  # animal | human | vehicle
    conf: float
    bbox: tuple[float, float, float, float]  # normalized x, y, w, h


@dataclass
class FramePrediction:
    path: Path
    detections: list[Detection] = field(default_factory=list)
    species_label: str | None = None
    species_score: float = 0.0


class VisionBackend(Protocol):
    name: str
    version: str

    def predict(self, frames: list[Path], country: str, admin1: str | None) -> list[FramePrediction]: ...


class SpeciesNetBackend:
    name = "speciesnet"
    _lock = threading.Lock()
    _model = None

    def __init__(self, model_name: str):
        self.model_name = model_name
        self.version = model_name.rsplit("/", 2)[-2] if "/" in model_name else model_name

    def _load(self):
        with self._lock:
            if SpeciesNetBackend._model is None:
                from speciesnet import SpeciesNet

                log.info("loading SpeciesNet %s", self.model_name)
                SpeciesNetBackend._model = SpeciesNet(self.model_name, components="all", geofence=True)
        return SpeciesNetBackend._model

    def predict(self, frames: list[Path], country: str, admin1: str | None) -> list[FramePrediction]:
        if not frames:
            return []
        model = self._load()
        result = model.predict(
            filepaths=[str(p) for p in frames],
            country=country,
            admin1_region=admin1,
            run_mode="multi_thread",
            batch_size=8,
            progress_bars=False,
        ) or {}
        by_path = {p.get("filepath"): p for p in result.get("predictions", [])}
        out: list[FramePrediction] = []
        for path in frames:
            pred = by_path.get(str(path), {})
            dets = [
                Detection(d.get("label", "animal"), float(d.get("conf", 0)), tuple(float(x) for x in d.get("bbox", [0, 0, 0, 0])))
                for d in pred.get("detections", []) or []
            ]
            out.append(FramePrediction(path, dets, pred.get("prediction"), float(pred.get("prediction_score") or 0)))
        return out


class MockBackend:
    """Reads `<frame>.json` sidecars if present; otherwise emits a boar walking across frames 2..N-2."""

    name = "mock"
    version = "mock-1"

    def predict(self, frames: list[Path], country: str, admin1: str | None) -> list[FramePrediction]:
        out: list[FramePrediction] = []
        boar = "a1;mammalia;cetartiodactyla;suidae;sus;scrofa;wild boar"
        for i, path in enumerate(frames):
            sidecar = path.with_suffix(".json")
            if sidecar.exists():
                data = json.loads(sidecar.read_text())
                dets = [Detection(d["label"], d["conf"], tuple(d["bbox"])) for d in data.get("detections", [])]
                out.append(FramePrediction(path, dets, data.get("prediction"), data.get("prediction_score", 0)))
                continue
            if 2 <= i < max(len(frames) - 2, 3):
                x = min(0.1 + 0.05 * i, 0.7)
                out.append(FramePrediction(path, [Detection("animal", 0.9, (x, 0.4, 0.2, 0.25))], boar, 0.88))
            else:
                out.append(FramePrediction(path, [], "b;;;;;;blank", 0.95))
        return out


def get_backend(name: str, model_name: str) -> VisionBackend:
    if name == "mock":
        return MockBackend()
    return SpeciesNetBackend(model_name)
