"""Detection + classification backends.

`SpeciesNetBackend` runs Google's SpeciesNet (MegaDetector + species classifier + geofenced
ensemble) as two stages: the detector on every sampled frame, then the classifier and ensemble
only on the frames the pipeline picks. `MockBackend` produces deterministic output for tests and CI.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

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
    raw: dict[str, Any] | None = field(default=None, repr=False)


class VisionBackend(Protocol):
    name: str
    version: str

    def warm(self) -> None: ...

    def detect(self, frames: list[Path]) -> list[FramePrediction]: ...

    def classify(self, preds: list[FramePrediction], country: str, admin1: str | None) -> None: ...


def _detection(d: dict[str, Any]) -> Detection:
    return Detection(d.get("label", "animal"), float(d.get("conf", 0)), tuple(float(x) for x in d.get("bbox", [0, 0, 0, 0])))


class SpeciesNetBackend:
    name = "speciesnet"
    _lock = threading.Lock()
    _parts = None
    _warm = False

    def __init__(self, model_name: str, detector_size: int = 640, classifier_batch: int = 8):
        self.model_name = model_name
        self.detector_size = detector_size
        self.classifier_batch = classifier_batch
        self.version = model_name.rsplit("/", 2)[-2] if "/" in model_name else model_name

    def _load(self):
        with self._lock:
            if SpeciesNetBackend._parts is None:
                import torch
                from speciesnet.classifier import SpeciesNetClassifier
                from speciesnet.detector import SpeciesNetDetector
                from speciesnet.ensemble import SpeciesNetEnsemble

                torch.set_num_threads(os.cpu_count() or 1)
                # MegaDetector's letterbox size is a class attribute read on every preprocess.
                SpeciesNetDetector.IMG_SIZE = self.detector_size
                started = time.monotonic()
                SpeciesNetBackend._parts = (
                    SpeciesNetDetector(self.model_name),
                    SpeciesNetClassifier(self.model_name),
                    SpeciesNetEnsemble(self.model_name, geofence=True),
                )
                log.info("loaded SpeciesNet %s in %.1fs (detector %dpx, %d threads)", self.model_name,
                         time.monotonic() - started, self.detector_size, torch.get_num_threads())
        return SpeciesNetBackend._parts

    def warm(self) -> None:
        """Load weights and run one dummy pass so the first real video doesn't pay for it."""
        detector, classifier, _ = self._load()
        if SpeciesNetBackend._warm:
            return
        from PIL import Image

        img = Image.new("RGB", (1280, 720), (96, 112, 72))
        detector.predict("warmup", detector.preprocess(img))
        classifier.batch_predict(["warmup"], [classifier.preprocess(img)])
        SpeciesNetBackend._warm = True

    def detect(self, frames: list[Path]) -> list[FramePrediction]:
        if not frames:
            return []
        detector, _, _ = self._load()
        from speciesnet.utils import load_rgb_image

        out: list[FramePrediction] = []
        # Decode + letterbox on a side thread while torch uses the cores for inference.
        with ThreadPoolExecutor(2) as pool:
            inputs = pool.map(lambda p: detector.preprocess(load_rgb_image(str(p))), frames)
            for path, img in zip(frames, inputs, strict=True):
                raw = detector.predict(str(path), img)
                out.append(FramePrediction(path, [_detection(d) for d in raw.get("detections") or []], raw=raw))
        return out

    def classify(self, preds: list[FramePrediction], country: str, admin1: str | None) -> None:
        preds = [p for p in preds if p.raw is not None and "failures" not in p.raw]
        if not preds:
            return
        _, classifier, ensemble = self._load()
        from speciesnet.utils import BBox, load_rgb_image

        def prepare(p: FramePrediction):
            bboxes = [BBox(*d["bbox"]) for d in p.raw.get("detections") or []]
            return classifier.preprocess(load_rgb_image(str(p.path)), bboxes=bboxes)

        paths = [str(p.path) for p in preds]
        with ThreadPoolExecutor(2) as pool:
            inputs = list(pool.map(prepare, preds))
        results: dict[str, Any] = {}
        for i in range(0, len(paths), self.classifier_batch):
            for r in classifier.batch_predict(paths[i : i + self.classifier_batch], inputs[i : i + self.classifier_batch]):
                results[r["filepath"]] = r
        geo = {p: {"country": country, "admin1_region": admin1} for p in paths}
        combined = ensemble.combine(
            filepaths=paths,
            classifier_results=results,
            detector_results={str(p.path): p.raw for p in preds},
            geolocation_results=geo,
            partial_predictions={},
        )
        for p, r in zip(preds, combined, strict=True):
            p.species_label, p.species_score = r.get("prediction"), float(r.get("prediction_score") or 0)


class MockBackend:
    """Reads `<frame>.json` sidecars if present; otherwise emits a boar walking across frames 2..N-2."""

    name = "mock"
    version = "mock-1"

    def warm(self) -> None:
        return None

    def detect(self, frames: list[Path]) -> list[FramePrediction]:
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

    def classify(self, preds: list[FramePrediction], country: str, admin1: str | None) -> None:
        return None


def get_backend(name: str, model_name: str, detector_size: int = 640) -> VisionBackend:
    if name == "mock":
        return MockBackend()
    return SpeciesNetBackend(model_name, detector_size)
