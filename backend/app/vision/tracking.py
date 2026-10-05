"""Tracking and event grouping.

`IoUTracker` is a ByteTrack-style two-pass greedy tracker: high-confidence detections are matched
first, then low-confidence detections may extend existing tracks (never start new ones).
`group_events` merges animal tracks into events when their time gaps are below a threshold.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field

BBox = tuple[float, float, float, float]  # x, y, w, h (normalized)


def iou(a: BBox, b: BBox) -> float:
    ax2, ay2, bx2, by2 = a[0] + a[2], a[1] + a[3], b[0] + b[2], b[1] + b[3]
    iw = max(0.0, min(ax2, bx2) - max(a[0], b[0]))
    ih = max(0.0, min(ay2, by2) - max(a[1], b[1]))
    inter = iw * ih
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


@dataclass
class TrackedDetection:
    t: float
    frame_index: int
    label: str
    conf: float
    bbox: BBox
    track_id: int
    species_label: str | None = None
    species_score: float = 0.0


@dataclass
class _Track:
    id: int
    label: str
    bbox: BBox
    last_t: float
    hits: int = 1


class IoUTracker:
    def __init__(self, iou_threshold: float = 0.2, max_gap_s: float = 4.0, high_conf: float = 0.5, low_conf: float = 0.15):
        self.iou_threshold = iou_threshold
        self.max_gap_s = max_gap_s
        self.high_conf = high_conf
        self.low_conf = low_conf
        self._tracks: list[_Track] = []
        self._next_id = 1

    def _active(self, t: float) -> list[_Track]:
        self._tracks = [tr for tr in self._tracks if t - tr.last_t <= self.max_gap_s]
        return self._tracks

    def _match(self, tracks: list[_Track], dets: list[tuple[int, str, float, BBox]]) -> tuple[dict[int, _Track], list[int]]:
        pairs = sorted(
            ((iou(tr.bbox, d[3]), ti, di) for ti, tr in enumerate(tracks) for di, d in enumerate(dets) if tr.label == d[1]),
            reverse=True,
        )
        used_t, matched = set(), {}
        for score, ti, di in pairs:
            if score < self.iou_threshold:
                break
            if ti in used_t or di in matched:
                continue
            used_t.add(ti)
            matched[di] = tracks[ti]
        unmatched = [di for di in range(len(dets)) if di not in matched]
        return matched, unmatched

    def update(self, t: float, frame_index: int, detections: list[tuple[str, float, BBox]]) -> list[TrackedDetection]:
        tracks = self._active(t)
        indexed = [(i, *d) for i, d in enumerate(detections) if d[1] >= self.low_conf]
        high = [d for d in indexed if d[2] >= self.high_conf]
        low = [d for d in indexed if d[2] < self.high_conf]
        out: list[TrackedDetection] = []

        matched, unmatched_high = self._match(tracks, high)
        remaining = [tr for tr in tracks if tr not in matched.values()]
        matched_low, _ = self._match(remaining, low)

        def emit(det, track: _Track) -> None:
            track.bbox, track.last_t, track.hits = det[3], t, track.hits + 1
            out.append(TrackedDetection(t, frame_index, det[1], det[2], det[3], track.id))

        for di, track in matched.items():
            emit(high[di], track)
        for di, track in matched_low.items():
            emit(low[di], track)
        for di in unmatched_high:
            det = high[di]
            track = _Track(self._next_id, det[1], det[3], t)
            self._next_id += 1
            self._tracks.append(track)
            out.append(TrackedDetection(t, frame_index, det[1], det[2], det[3], track.id))
        return out


@dataclass
class GroupedEvent:
    start_t: float
    end_t: float
    track_ids: list[int]
    detections: list[TrackedDetection]
    species_label: str | None
    species_conf: float
    max_individuals: int
    best: TrackedDetection
    contains_people: bool = False
    votes: dict[str, float] = field(default_factory=dict)


def vote_species(dets: list[TrackedDetection], label_to_key) -> tuple[str | None, float, dict[str, float]]:
    """Confidence-weighted vote over frame-level species predictions, grouped by product species key."""
    weights: dict[str, float] = defaultdict(float)
    representative: dict[str, tuple[float, str]] = {}
    for d in dets:
        if not d.species_label:
            continue
        key = label_to_key(d.species_label)
        if key is None:
            continue
        w = d.species_score * d.conf
        weights[key] += w
        if d.species_score > representative.get(key, (0.0, ""))[0]:
            representative[key] = (d.species_score, d.species_label)
    if not weights:
        return None, 0.0, {}
    total = sum(weights.values())
    winner = max(weights, key=weights.get)
    share = weights[winner] / total
    scores = [d.species_score for d in dets if d.species_label and label_to_key(d.species_label) == winner]
    mean_score = sum(scores) / len(scores) if scores else 0.0
    # Confidence = model's mean score for the winning species, discounted by disagreement between frames.
    conf = round(mean_score * (0.6 + 0.4 * share), 4)
    return representative[winner][1], conf, {k: round(v / total, 3) for k, v in weights.items()}


def split_by_species(cluster: list[TrackedDetection], label_to_key, min_score: float = 0.5) -> list[list[TrackedDetection]]:
    """Split a time cluster where the confident species changes and the new species holds for two sampled frames."""
    frames: dict[int, list[TrackedDetection]] = defaultdict(list)
    for d in cluster:
        frames[d.frame_index].append(d)
    ordered = [frames[i] for i in sorted(frames, key=lambda i: frames[i][0].t)]

    def frame_keys(dets: list[TrackedDetection]) -> dict[str, float]:
        scores: dict[str, float] = defaultdict(float)
        for d in dets:
            if d.species_label and d.species_score >= min_score:
                key = label_to_key(d.species_label)
                if key:
                    scores[key] += d.species_score
        return scores

    keys = [frame_keys(f) for f in ordered]
    segments: list[list[TrackedDetection]] = [[]]
    current: str | None = None
    for i, dets in enumerate(ordered):
        here = keys[i]
        if current is None and here:
            current = max(here, key=here.get)
        elif here and current not in here:
            following = keys[i + 1] if i + 1 < len(keys) else here
            shared = {k: v for k, v in here.items() if k in following}
            if shared and current not in following:
                segments.append([])
                current = max(shared, key=shared.get)
        segments[-1].extend(dets)
    return [s for s in segments if s]


def group_events(
    detections: list[TrackedDetection],
    gap_s: float,
    label_to_key,
    people: list[TrackedDetection] | None = None,
) -> list[GroupedEvent]:
    animals = sorted((d for d in detections if d.label == "animal"), key=lambda d: d.t)
    if not animals:
        return []
    time_clusters: list[list[TrackedDetection]] = [[animals[0]]]
    for d in animals[1:]:
        if d.t - time_clusters[-1][-1].t <= gap_s:
            time_clusters[-1].append(d)
        else:
            time_clusters.append([d])
    clusters = [segment for cluster in time_clusters for segment in split_by_species(cluster, label_to_key)]

    people = people or []
    events: list[GroupedEvent] = []
    for cluster in clusters:
        per_frame = Counter(d.frame_index for d in cluster)
        species_label, species_conf, votes = vote_species(cluster, label_to_key)
        best = max(cluster, key=lambda d: (d.conf * max(d.species_score, 0.01), d.conf))
        start, end = cluster[0].t, cluster[-1].t
        events.append(GroupedEvent(
            start_t=start,
            end_t=end,
            track_ids=sorted({d.track_id for d in cluster}),
            detections=cluster,
            species_label=species_label,
            species_conf=species_conf,
            max_individuals=max(per_frame.values()),
            best=best,
            contains_people=any(start - 2 <= p.t <= end + 2 for p in people),
            votes=votes,
        ))
    return events
