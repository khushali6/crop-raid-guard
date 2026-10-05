"""Deterministic, explainable crop-raid risk score (heuristic, not a scientific probability).

risk = w_species * species_risk(crop) + w_freq * repeat_visits(7d) + w_time * nocturnal
     + w_trend * increase_vs_previous_week + w_dur * dwell_time + w_group * group_size
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from app.vision.species import get_profile

RISK_MODEL = "risk-v1"
WEIGHTS = {"species": 40, "frequency": 20, "time": 12, "trend": 10, "dwell": 10, "group": 8}


@dataclass
class RiskInputs:
    species_key: str
    crop: str | None
    local_start: datetime
    duration_s: float
    individuals: int
    visits_7d: int  # earlier events of this species on this farm in the last 7 days
    visits_prev_7d: int  # events of this species on this farm 7-14 days ago
    species_conf: float


@dataclass
class RiskResult:
    score: int
    band: str
    factors: list[dict] = field(default_factory=list)
    model: str = RISK_MODEL


def band_for(score: int) -> str:
    return "High" if score >= 70 else "Moderate" if score >= 40 else "Low"


def _night_factor(hour: int) -> float:
    if hour >= 22 or hour < 4:
        return 1.0
    if hour >= 19 or hour < 6:
        return 0.7
    return 0.15


def compute_risk(i: RiskInputs) -> RiskResult:
    profile = get_profile(i.species_key)
    species_risk = profile.risk_for(i.crop)
    frequency = min(i.visits_7d / 4.0, 1.0)
    night = _night_factor(i.local_start.hour)
    if i.visits_prev_7d == 0:
        trend = 1.0 if i.visits_7d >= 2 else 0.5 if i.visits_7d == 1 else 0.0
    else:
        trend = max(0.0, min((i.visits_7d + 1 - i.visits_prev_7d) / max(i.visits_prev_7d, 1), 1.0))
    dwell = min(i.duration_s / 120.0, 1.0)
    group = min(max(i.individuals - 1, 0) / 3.0, 1.0)

    raw = {
        "species": species_risk,
        "frequency": frequency,
        "time": night,
        "trend": trend,
        "dwell": dwell,
        "group": group,
    }
    contributions = {k: WEIGHTS[k] * v for k, v in raw.items()}
    score = int(round(sum(contributions.values())))
    # Low-confidence identifications cannot reach "High" on species weight alone.
    if i.species_conf < 0.5:
        score = min(score, 69)
    score = max(0, min(score, 100))

    labels = {
        "species": f"{profile.common} risk to {(i.crop or 'this crop').lower()}",
        "frequency": f"{i.visits_7d} earlier visit{'s' if i.visits_7d != 1 else ''} in the last 7 days",
        "time": "Night-time visit" if night >= 0.7 else "Daytime visit",
        "trend": "Visits increasing vs previous week" if trend >= 0.5 else "No rising trend",
        "dwell": f"Stayed about {int(round(i.duration_s))} seconds",
        "group": f"{i.individuals} individual{'s' if i.individuals != 1 else ''} seen together",
    }
    factors = [
        {"key": k, "label": labels[k], "value": round(raw[k], 3), "weight": WEIGHTS[k], "contribution": round(contributions[k], 1)}
        for k in sorted(contributions, key=contributions.get, reverse=True)
    ]
    return RiskResult(score, band_for(score), factors)
