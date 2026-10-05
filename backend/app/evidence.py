"""Evidence Packs: zip of clips, keyframes, an HTML report and a signed manifest.

manifest.json lists every file with its SHA-256; signature.json holds an Ed25519 signature over the
SHA-256 of the canonical manifest. Anyone can verify with the published public key.
Usage: python -m app.evidence keygen
"""

from __future__ import annotations

import base64
import hashlib
import html
import io
import json
import sys
import zipfile
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from app import db, storage
from app.config import get_settings

TZ = ZoneInfo("Asia/Kolkata")
DISCLAIMER = ("This pack documents camera footage and automated detections. It supports, but does not guarantee, "
              "acceptance of an insurance or compensation claim. Official PMFBY reports must be filed through the "
              "Crop Insurance App or helpline within 72 hours.")


class EvidenceError(RuntimeError):
    pass


def _private_key() -> Ed25519PrivateKey:
    seed = get_settings().evidence_signing_key
    if not seed:
        raise EvidenceError("EVIDENCE_SIGNING_KEY is not configured; run `python -m app.evidence keygen`.")
    return Ed25519PrivateKey.from_private_bytes(base64.b64decode(seed))


def public_key_b64() -> str:
    raw = _private_key().public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return base64.b64encode(raw).decode()


def canonical(manifest: dict) -> bytes:
    return json.dumps(manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str).encode()


def sign_manifest(manifest: dict) -> dict:
    digest = hashlib.sha256(canonical(manifest)).hexdigest()
    sig = _private_key().sign(bytes.fromhex(digest))
    return {"alg": "Ed25519", "key_id": get_settings().evidence_key_id, "manifest_sha256": digest,
            "signature": base64.b64encode(sig).decode(), "signed_at": datetime.now(UTC).isoformat()}


def verify(manifest: dict, signature: dict, public_key: str | None = None) -> dict:
    digest = hashlib.sha256(canonical(manifest)).hexdigest()
    if digest != signature.get("manifest_sha256"):
        return {"valid": False, "reason": "The manifest has been modified since it was signed."}
    try:
        key = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key or public_key_b64()))
        key.verify(base64.b64decode(signature["signature"]), bytes.fromhex(digest))
    except (InvalidSignature, ValueError, KeyError):
        return {"valid": False, "reason": "The signature does not match this manifest."}
    return {"valid": True, "manifest_sha256": digest, "key_id": signature.get("key_id"), "signed_at": signature.get("signed_at")}


def verify_zip(data: bytes) -> dict:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
            signature = json.loads(zf.read("signature.json"))
            result = verify(manifest, signature)
            if not result["valid"]:
                return result
            for f in manifest.get("files", []):
                try:
                    content = zf.read(f["path"])
                except KeyError:
                    return {"valid": False, "reason": f"File {f['path']} is missing from the pack."}
                if hashlib.sha256(content).hexdigest() != f["sha256"]:
                    return {"valid": False, "reason": f"File {f['path']} does not match its recorded hash."}
            result["files"] = len(manifest.get("files", []))
    except zipfile.BadZipFile:
        return {"valid": False, "reason": "This is not a valid evidence pack (zip) file."}
    except (KeyError, ValueError, TypeError):
        return {"valid": False, "reason": "The pack is missing manifest.json or signature.json, or they are malformed."}
    return result


def _report_html(manifest: dict) -> str:
    rows = "".join(
        f"<tr><td>{html.escape(e['local_time'])}</td><td>{html.escape(e['species'])}</td><td>{e['confidence_pct']}%</td>"
        f"<td>{html.escape(e['review_status'])}</td><td>{e['risk_score']} ({html.escape(e['risk_band'])})</td>"
        f"<td>{e['duration_s']:.0f}s</td><td><img src='{html.escape(e['keyframe'] or '')}' width='220'></td></tr>"
        for e in manifest["events"]
    )
    farm = manifest["farm"]
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>Evidence pack {manifest['pack_id']}</title>
<style>body{{font-family:system-ui,sans-serif;color:#2b3326;margin:32px}}h1{{font-family:Georgia,serif;font-weight:500}}
table{{border-collapse:collapse;width:100%;font-size:13px}}td,th{{border-bottom:1px solid #ddd;padding:8px;text-align:left;vertical-align:top}}
.note{{background:#f1f2ea;padding:12px;font-size:12px;margin-top:20px}}</style></head><body>
<h1>Crop Raid Guard evidence pack</h1>
<p><strong>Farm:</strong> {html.escape(farm['name'])} ({html.escape(farm['crop'] or '')}){' · ' + html.escape(farm['village']) if farm.get('village') else ''}<br>
<strong>Incident window:</strong> {html.escape(manifest['incident']['first_local'])} to {html.escape(manifest['incident']['last_local'])}<br>
<strong>Report deadline (72h):</strong> {html.escape(manifest['incident']['deadline_local'])}<br>
<strong>Generated:</strong> {html.escape(manifest['generated_at'])} · Pack {html.escape(manifest['pack_id'])}</p>
<table><tr><th>Time (IST)</th><th>Species</th><th>Confidence</th><th>Human review</th><th>Risk</th><th>Duration</th><th>Keyframe</th></tr>{rows}</table>
<p class="note">Models: {html.escape(json.dumps(manifest['models']))}. Every file's SHA-256 is listed in manifest.json and the manifest is
signed (signature.json, Ed25519, key {html.escape(manifest['signing_key_id'])}). Verify at {html.escape(manifest['verify_url'])}.</p>
<p class="note">{html.escape(DISCLAIMER)}</p></body></html>"""


async def build_pack(*, user_id: str, org_id: str, claim_id: str | None, event_ids: list[str] | None = None) -> dict[str, Any]:
    s = get_settings()
    async with db.as_user(user_id, read_only=True) as conn:
        if claim_id:
            claim = await db.fetch_one(conn, "select * from public.claims where id = %s", (claim_id,))
            if not claim:
                raise EvidenceError("Claim not found.")
            event_ids = [str(e) for e in claim["event_ids"]]
            farm_id = str(claim["farm_id"])
        if not event_ids:
            raise EvidenceError("Select at least one event.")
        events = await db.fetch_all(
            conn,
            """select e.*, v.sha256 as video_sha256, v.storage_path as video_path, v.captured_at as video_captured_at,
                      v.device_captured_at, v.capture_time_mismatch, v.model_versions, c.name as camera_name
               from public.events e join public.videos v on v.id = e.video_id left join public.cameras c on c.id = e.camera_id
               where e.id = any(%s::uuid[]) order by e.started_at""",
            (event_ids,),
        )
        if len(events) != len(set(event_ids)):
            raise EvidenceError("Some events were not found or you cannot access them.")
        farm_id = str(events[0]["farm_id"])
        if any(str(e["farm_id"]) != farm_id for e in events):
            raise EvidenceError("All events in a pack must come from the same farm.")
        farm = await db.fetch_one(
            conn, "select id, name, crop, village, extensions.st_asgeojson(location::extensions.geometry) as location from public.farms where id = %s",
            (farm_id,),
        )

    async with db.service() as conn:
        row = await db.fetch_one(conn, "select gen_random_uuid() as id")
    pack_id = str(row["id"])
    buf = io.BytesIO()
    files: list[dict] = []
    manifest_events: list[dict] = []

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        def add(path: str, data: bytes, kind: str) -> None:
            zf.writestr(path, data)
            files.append({"path": path, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "kind": kind})

        for i, e in enumerate(events, start=1):
            keyframe = clip = None
            if e["keyframe_path"]:
                keyframe = f"frames/event-{i:02d}.jpg"
                add(keyframe, await storage.download_bytes("media", e["keyframe_path"]), "keyframe")
            if e["clip_path"] and not e["contains_people"]:
                clip = f"clips/event-{i:02d}.mp4"
                add(clip, await storage.download_bytes("media", e["clip_path"]), "clip")
            local = e["started_at"].astimezone(TZ)
            manifest_events.append({
                "event_id": str(e["id"]), "video_id": str(e["video_id"]), "video_sha256": e["video_sha256"],
                "camera": e["camera_name"], "started_at": e["started_at"].isoformat(), "local_time": local.strftime("%d %b %Y %I:%M:%S %p"),
                "offset_s": round(e["start_offset_s"], 2), "duration_s": float(e["duration_s"] or 0),
                "species": e["final_common_name"], "species_key": e["final_species_key"], "model_label": e["model_label"],
                "confidence_pct": int(round(e["species_conf"] * 100)), "individuals": e["max_individuals"],
                "review_status": e["review_status"], "reviewed_at": e["reviewed_at"].isoformat() if e["reviewed_at"] else None,
                "risk_score": e["risk_score"], "risk_band": e["risk_band"], "risk_factors": e["risk_factors"],
                "capture_time_mismatch": e["capture_time_mismatch"],
                "device_captured_at": e["device_captured_at"].isoformat() if e["device_captured_at"] else None,
                "clip": clip, "keyframe": keyframe,
                "clip_omitted_reason": "people visible in clip" if e["contains_people"] else None,
            })

        first, last = events[0]["started_at"], events[-1]["started_at"]
        manifest = {
            "schema": "crop-raid-guard/evidence-pack@1",
            "pack_id": pack_id, "org_id": org_id, "claim_id": claim_id,
            "generated_at": datetime.now(UTC).isoformat(), "generated_by": user_id,
            "farm": {"id": farm_id, "name": farm["name"], "crop": farm["crop"], "village": farm["village"],
                     "location_geojson": json.loads(farm["location"]) if farm["location"] else None},
            "incident": {"first": first.isoformat(), "last": last.isoformat(),
                         "first_local": first.astimezone(TZ).strftime("%d %b %Y %I:%M %p IST"),
                         "last_local": last.astimezone(TZ).strftime("%d %b %Y %I:%M %p IST"),
                         "deadline_local": (first + timedelta(hours=72)).astimezone(TZ).strftime("%d %b %Y %I:%M %p IST")},
            "events": manifest_events,
            "models": events[0]["model_versions"],
            "signing_key_id": s.evidence_key_id,
            "verify_url": f"{s.public_api_url.rstrip('/')}/v1/evidence/verify",
            "disclaimer": DISCLAIMER,
        }
        add("report.html", _report_html(manifest).encode(), "report")
        manifest["files"] = files
        signature = sign_manifest(manifest)
        zf.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False, default=str))
        zf.writestr("signature.json", json.dumps(signature, indent=2))
        zf.writestr("public_key.txt", public_key_b64() + "\n")

    data = buf.getvalue()
    path = f"{org_id}/{pack_id}.zip"
    await storage.upload("evidence", path, data, "application/zip")
    async with db.service() as conn:
        await conn.execute(
            """insert into public.evidence_packs (id, org_id, farm_id, claim_id, event_ids, manifest, manifest_sha256, signature,
                 signing_key_id, storage_path, size_bytes, created_by) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (pack_id, org_id, farm_id, claim_id, [m["event_id"] for m in manifest_events], json.dumps(manifest, default=str),
             signature["manifest_sha256"], signature["signature"], signature["key_id"], path, len(data), user_id),
        )
        if claim_id:
            await conn.execute(
                "update public.claims set evidence_pack_id = %s, status = case when status = 'draft' then 'evidence_ready'::public.claim_status else status end where id = %s",
                (pack_id, claim_id),
            )
        await db.audit(conn, org_id=org_id, actor_id=user_id, actor_kind="user", action="evidence.build", entity="evidence_pack",
                       entity_id=pack_id, payload={"claim_id": claim_id, "events": len(manifest_events)})
    url = await storage.sign("evidence", path, 3600, f"evidence-{pack_id[:8]}.zip")
    return {"id": pack_id, "manifest_sha256": signature["manifest_sha256"], "url": url, "size_bytes": len(data),
            "events": len(manifest_events)}


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "keygen":
        key = Ed25519PrivateKey.generate()
        seed = key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
        print("EVIDENCE_SIGNING_KEY=" + base64.b64encode(seed).decode())
    else:
        print(__doc__)
