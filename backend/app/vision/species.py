"""Species catalog for Indian crop raiders and mapping from SpeciesNet taxonomy labels.

SpeciesNet labels look like "uuid;class;order;family;genus;species;common name". We map them to
stable keys used across the product, with crop-specific damage weights for the risk engine.
"""

from __future__ import annotations

from dataclasses import dataclass, field

CROPS = ("maize", "rice", "sugarcane", "wheat", "groundnut", "cotton", "vegetables", "other")


@dataclass(frozen=True)
class Species:
    key: str
    common: str
    scientific: str | None
    group: str
    base_risk: float  # 0..1 general crop-raiding propensity
    crop_risk: dict[str, float] = field(default_factory=dict)  # crop -> 0..1 override
    review_threshold: float = 0.7
    nocturnal: bool = False

    def risk_for(self, crop: str | None) -> float:
        return self.crop_risk.get((crop or "other").strip().lower(), self.base_risk)


CATALOG: dict[str, Species] = {
    s.key: s
    for s in [
        Species("wild_boar", "Wild boar", "Sus scrofa", "suid", 0.9,
                {"maize": 1.0, "groundnut": 1.0, "sugarcane": 0.9, "rice": 0.85, "vegetables": 0.9, "wheat": 0.7},
                review_threshold=0.75, nocturnal=True),
        Species("nilgai", "Nilgai", "Boselaphus tragocamelus", "antelope", 0.85,
                {"wheat": 1.0, "maize": 0.9, "vegetables": 0.9, "groundnut": 0.85, "rice": 0.7}, review_threshold=0.75),
        Species("blackbuck", "Blackbuck", "Antilope cervicapra", "antelope", 0.6, {"wheat": 0.75, "groundnut": 0.7}),
        Species("spotted_deer", "Spotted deer", "Axis axis", "deer", 0.6, {"rice": 0.7, "wheat": 0.65, "vegetables": 0.7}),
        Species("sambar", "Sambar deer", "Rusa unicolor", "deer", 0.6, {"sugarcane": 0.7, "rice": 0.65}, nocturnal=True),
        Species("barking_deer", "Barking deer", "Muntiacus muntjak", "deer", 0.4),
        Species("asian_elephant", "Asian elephant", "Elephas maximus", "elephant", 1.0,
                {"sugarcane": 1.0, "rice": 1.0, "maize": 1.0}, review_threshold=0.8, nocturnal=True),
        Species("gaur", "Gaur", "Bos gaurus", "bovid", 0.7, nocturnal=True),
        Species("rhesus_macaque", "Rhesus macaque", "Macaca mulatta", "primate", 0.75,
                {"maize": 0.85, "vegetables": 0.9, "groundnut": 0.8}),
        Species("bonnet_macaque", "Bonnet macaque", "Macaca radiata", "primate", 0.7, {"vegetables": 0.85, "maize": 0.8}),
        Species("langur", "Gray langur", "Semnopithecus", "primate", 0.55, {"vegetables": 0.7}),
        Species("indian_peafowl", "Indian peafowl", "Pavo cristatus", "bird", 0.45,
                {"groundnut": 0.6, "vegetables": 0.55, "maize": 0.4, "rice": 0.4}),
        Species("porcupine", "Indian crested porcupine", "Hystrix indica", "rodent", 0.6,
                {"groundnut": 0.8, "vegetables": 0.75, "maize": 0.6}, nocturnal=True),
        Species("golden_jackal", "Golden jackal", "Canis aureus", "canid", 0.4,
                {"maize": 0.55, "sugarcane": 0.45, "vegetables": 0.45}, nocturnal=True),
        Species("indian_hare", "Indian hare", "Lepus nigricollis", "lagomorph", 0.3, {"vegetables": 0.45}, nocturnal=True),
        Species("rodent", "Rodent", None, "rodent", 0.35, {"rice": 0.5, "wheat": 0.45}, nocturnal=True),
        Species("cattle", "Cattle (domestic)", "Bos taurus", "domestic", 0.5),
        Species("feral_dog", "Dog", "Canis familiaris", "domestic", 0.1),
        Species("bird", "Bird", None, "bird", 0.25, {"rice": 0.35, "maize": 0.3}),
        Species("deer", "Deer", None, "deer", 0.55),
        # SpeciesNet's geofence often rolls nilgai up to family level; on Indian farms that is usually nilgai,
        # but it can be blackbuck or gaur, so a person must confirm.
        Species("wild_bovid", "Antelope or wild cattle (possibly nilgai)", None, "antelope", 0.75,
                {"wheat": 0.9, "maize": 0.8, "vegetables": 0.8, "groundnut": 0.75, "rice": 0.6}, review_threshold=1.01),
        Species("primate", "Monkey", None, "primate", 0.65),
        Species("animal", "Unidentified animal", None, "unknown", 0.4, review_threshold=1.01),
    ]
}

# Ordered (scope, value) -> key. Earlier rules win.
_RULES: list[tuple[str, str, str]] = [
    ("species", "sus scrofa", "wild_boar"),
    ("genus", "sus", "wild_boar"),
    ("species", "boselaphus tragocamelus", "nilgai"),
    ("species", "antilope cervicapra", "blackbuck"),
    ("species", "axis axis", "spotted_deer"),
    ("species", "rusa unicolor", "sambar"),
    ("genus", "muntiacus", "barking_deer"),
    ("species", "elephas maximus", "asian_elephant"),
    ("family", "elephantidae", "asian_elephant"),
    ("species", "bos gaurus", "gaur"),
    ("species", "macaca mulatta", "rhesus_macaque"),
    ("species", "macaca radiata", "bonnet_macaque"),
    ("genus", "semnopithecus", "langur"),
    ("species", "pavo cristatus", "indian_peafowl"),
    ("genus", "pavo", "indian_peafowl"),
    ("genus", "hystrix", "porcupine"),
    ("species", "canis aureus", "golden_jackal"),
    ("species", "canis familiaris", "feral_dog"),
    ("species", "lupus familiaris", "feral_dog"),
    ("genus", "lepus", "indian_hare"),
    ("species", "bos taurus", "cattle"),
    ("species", "bos indicus", "cattle"),
    ("genus", "macaca", "primate"),
    ("family", "cercopithecidae", "primate"),
    ("family", "cervidae", "deer"),
    ("family", "bovidae", "wild_bovid"),
    ("family", "suidae", "wild_boar"),
    ("order", "rodentia", "rodent"),
    ("class", "aves", "bird"),
]


@dataclass(frozen=True)
class MappedSpecies:
    key: str
    common: str
    scientific: str | None
    model_label: str | None
    known: bool


def parse_label(label: str) -> dict[str, str]:
    parts = (label or "").split(";")
    parts += [""] * (7 - len(parts))
    _uuid, cls, order, family, genus, species, common = parts[:7]
    sci = f"{genus} {species}".strip() if genus and species else ""
    return {
        "class": cls.lower(),
        "order": order.lower(),
        "family": family.lower(),
        "genus": genus.lower(),
        "species": sci.lower(),
        "common": common.strip(),
    }


def map_label(label: str | None) -> MappedSpecies | None:
    """Return the product species for a SpeciesNet label, or None for blank/human/vehicle."""
    if not label:
        return None
    p = parse_label(label)
    common = p["common"].lower()
    if common in ("blank", "human", "vehicle") or p["species"] == "homo sapiens":
        return None
    for scope, value, key in _RULES:
        if p.get(scope) == value:
            sp = CATALOG[key]
            return MappedSpecies(sp.key, sp.common, sp.scientific, label, True)
    if common in ("animal", "") or not p["class"]:
        sp = CATALOG["animal"]
        return MappedSpecies(sp.key, sp.common, None, label, True)
    # Not a known crop raider: keep the model's own name with a generic risk profile.
    key = (p["species"] or p["genus"] or p["family"] or common).replace(" ", "_")[:60] or "animal"
    scientific = p["species"].capitalize() if p["species"] else None
    return MappedSpecies(key, p["common"].capitalize() or "Animal", scientific, label, False)


def get_profile(key: str) -> Species:
    return CATALOG.get(key) or Species(key, key.replace("_", " ").capitalize(), None, "other", 0.3)


def catalog_options() -> list[dict[str, str]]:
    return [{"key": s.key, "common": s.common} for s in CATALOG.values()]
