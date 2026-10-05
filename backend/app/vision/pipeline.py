"""End-to-end video analysis job.

video -> probe -> motion-aware frame sampling -> SpeciesNet (MegaDetector + classifier, geofenced)
      -> tracker -> event grouper -> risk engine -> clips/keyframes -> events + embeddings -> alerts
Re-running a job is idempotent: existing events for the video are replaced.
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import tempfile
import time
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from app import db, llm, notify, storage
from app.config import get_settings
from app.guardrails import fence_untrusted
from app.vision import media, render
from app.vision.detector import FramePrediction, get_backend
from app.vision.risk import RiskInputs, compute_risk
from app.vision.species import get_profile, map_label
from app.vision.tracking import GroupedEvent, IoUTracker, TrackedDetection, group_events

log = logging.getLogger(__name__)
TZ = ZoneInfo("Asia/Kolkata")


class JobError(RuntimeError):
    """Error with a message that is safe to show to the user."""


@dataclass
class Analysis:
    meta: media.VideoMeta
    frames_sampled: int
    frames_analyzed: int
    predictions: dict[int, FramePrediction]
    frame_paths: dict[int, Path]
    events: list[GroupedEvent]
    backend: str
    backend_version: str


async def _progress(video_id: str, progress: int, stage: str, status: str = "processing") -> None:
    async with db.service() as conn:
        await conn.execute(
            "update public.videos set progress = %s, stage = %s, status = %s where id = %s",
            (progress, stage, status, video_id),
        )


def _label_key(label: str) -> str | None:
    mapped = map_label(label)
    return mapped.key if mapped else None


def _run_vision(video_path: Path, work: Path, on_batch) -> Analysis:
    s = get_settings()
    meta = media.probe(video_path)
    frames = media.extract_frames(video_path, work / "frames", s.sample_fps)
    if not frames:
        raise JobError("No frames could be read from this video.")
    media.score_motion(frames)
    selected = media.select_frames(frames, s.motion_threshold, s.keepalive_every_s, s.max_frames)
    backend = get_backend(s.vision_backend, s.speciesnet_model)

    predictions: dict[int, FramePrediction] = {}
    batch = 24
    for start in range(0, len(selected), batch):
        chunk = selected[start : start + batch]
        for fr, pred in zip(chunk, backend.predict([f.path for f in chunk], s.country_code, s.admin1_region), strict=True):
            predictions[fr.index] = pred
        on_batch(min(start + batch, len(selected)), len(selected))

    tracker = IoUTracker()
    tracked: list[TrackedDetection] = []
    people: list[TrackedDetection] = []
    for fr in selected:
        pred = predictions[fr.index]
        dets = [(d.label, d.conf, d.bbox) for d in pred.detections if d.conf >= s.detection_threshold]
        for td in tracker.update(fr.t, fr.index, dets):
            td.species_label, td.species_score = pred.species_label, pred.species_score
            (people if td.label == "human" else tracked).append(td)
    events = group_events(tracked, s.event_gap_s, _label_key, people)
    return Analysis(meta, len(frames), len(selected), predictions, {f.index: f.path for f in frames}, events,
                    backend.name, backend.version)


async def _history(conn, farm_id: str, species_key: str, started_at) -> tuple[int, int]:
    row = await db.fetch_one(
        conn,
        """select
             count(*) filter (where started_at >= %(t)s - interval '7 days' and started_at < %(t)s) as last7,
             count(*) filter (where started_at >= %(t)s - interval '14 days' and started_at < %(t)s - interval '7 days') as prev7
           from public.events
           where farm_id = %(farm)s and final_species_key = %(sp)s and review_status <> 'rejected'""",
        {"t": started_at, "farm": farm_id, "sp": species_key},
    )
    return int(row["last7"]), int(row["prev7"])


def _describe(common: str, scientific: str | None, farm: str, crop: str, local, duration: float, individuals: int, camera: str | None) -> str:
    sci = f" ({scientific})" if scientific else ""
    when = local.strftime("%d %b %Y at %I:%M %p IST")
    period = "night" if local.hour >= 19 or local.hour < 6 else "day"
    cam = f" by {camera}" if camera else ""
    return (f"{common}{sci} recorded{cam} at {farm} ({crop} field) on {when}, during the {period}. "
            f"Visible for about {int(round(duration))} seconds with {individuals} individual{'s' if individuals != 1 else ''}.")


async def analyze_video(job: dict[str, Any]) -> None:
    s = get_settings()
    video_id = str(job["video_id"])
    async with db.service() as conn:
        video = await db.fetch_one(
            conn,
            """select v.*, f.name as farm_name, f.crop, c.name as camera_name
               from public.videos v join public.farms f on f.id = v.farm_id
               left join public.cameras c on c.id = v.camera_id where v.id = %s""",
            (video_id,),
        )
    if not video:
        log.info("video %s no longer exists; skipping", video_id)
        return

    org_id = str(video["org_id"])
    work = Path(tempfile.mkdtemp(prefix=f"crg-{video_id[:8]}-"))
    loop = asyncio.get_running_loop()
    try:
        await _progress(video_id, 5, "Preparing footage")
        src = await storage.download("videos", video["storage_path"], work / "source")

        def on_batch(done: int, total: int) -> None:
            pct = 20 + int(50 * done / max(total, 1))
            asyncio.run_coroutine_threadsafe(_progress(video_id, pct, f"Detecting wildlife ({done}/{total} frames)"), loop)

        await _progress(video_id, 12, "Sampling frames")
        try:
            analysis = await asyncio.to_thread(_run_vision, src, work, on_batch)
        except media.MediaError as exc:
            raise JobError(f"We could not read this video: {exc}") from exc

        meta = analysis.meta
        await _progress(video_id, 74, "Grouping activity")

        playback_path = None
        if meta.codec != "h264" or "mp4" not in meta.container:
            web = await asyncio.to_thread(media.transcode_web, src, work / "web.mp4")
            playback_path = await storage.upload("media", f"{org_id}/{video_id}/playback.mp4", web, "video/mp4")

        captured_at = video["captured_at"]
        mismatch = bool(meta.creation_time and abs((meta.creation_time - captured_at).total_seconds()) > 86400)

        async with db.service() as conn:
            in_claim = await db.fetch_one(
                conn,
                """select 1 from public.claims c where c.org_id = %s and exists (
                     select 1 from public.events e where e.video_id = %s and e.id = any(c.event_ids)) limit 1""",
                (org_id, video_id),
            )
            if in_claim:
                raise JobError("This video's events are part of a claim, so it cannot be re-analysed without changing the evidence.")
            await conn.execute("delete from public.events where video_id = %s", (video_id,))
            await conn.execute("delete from public.alerts where video_id = %s", (video_id,))

        created: list[dict[str, Any]] = []
        total = max(len(analysis.events), 1)
        for n, ev in enumerate(analysis.events):
            await _progress(video_id, 76 + int(18 * n / total), f"Building evidence ({n + 1}/{len(analysis.events)})")
            created.append(await _store_event(video, ev, analysis, src, work, captured_at))

        thumb_frame = None
        if created:
            best = max(analysis.events, key=lambda e: e.best.conf)
            thumb_frame = analysis.frame_paths.get(best.best.frame_index)
        if thumb_frame is None and analysis.frame_paths:
            thumb_frame = analysis.frame_paths[sorted(analysis.frame_paths)[len(analysis.frame_paths) // 2]]
        thumb_path = None
        if thumb_frame:
            thumb_path = await storage.upload("media", f"{org_id}/{video_id}/thumb.jpg", render.thumbnail(thumb_frame), "image/jpeg")

        await _progress(video_id, 96, "Sending alerts")
        await _raise_alerts(video, created)

        async with db.service() as conn:
            await conn.execute(
                """update public.videos set status = 'completed', progress = 100, stage = 'Analysis complete', error = null,
                     duration_s = %s, fps = %s, width = %s, height = %s, device_captured_at = %s,
                     capture_time_mismatch = %s, thumbnail_path = %s, playback_path = coalesce(%s, playback_path),
                     frames_sampled = %s, frames_analyzed = %s, processed_at = now(), model_versions = %s
                   where id = %s""",
                (meta.duration_s, meta.fps, meta.width, meta.height, meta.creation_time, mismatch, thumb_path, playback_path,
                 analysis.frames_sampled, analysis.frames_analyzed,
                 json.dumps({"vision": f"{analysis.backend}:{analysis.backend_version}", "risk": "risk-v1",
                             "embedding": s.embed_model if s.llm_enabled else None}),
                 video_id),
            )
            await db.audit(conn, org_id=org_id, actor_id=None, actor_kind="system", action="video.analyzed",
                           entity="video", entity_id=video_id, payload={"events": len(created)})
            if (video.get("options") or {}).get("report"):
                await conn.execute(
                    "insert into public.jobs (kind, org_id, video_id, payload, idempotency_key) values"
                    " ('generate_report', %s, %s, %s, %s) on conflict (idempotency_key) do nothing",
                    (org_id, video_id, json.dumps({"user_id": str(video["uploaded_by"]) if video["uploaded_by"] else None}),
                     f"report:{video_id}:{int(time.time())}"),
                )
        await _notify_done(video, len(created))
    finally:
        shutil.rmtree(work, ignore_errors=True)


async def _store_event(video: dict, ev: GroupedEvent, analysis: Analysis, src: Path, work: Path, captured_at) -> dict[str, Any]:
    s = get_settings()
    org_id, farm_id, video_id = str(video["org_id"]), str(video["farm_id"]), str(video["id"])
    mapped = map_label(ev.species_label) if ev.species_label else None
    key = mapped.key if mapped else "animal"
    common = mapped.common if mapped else "Unidentified animal"
    scientific = mapped.scientific if mapped else None
    profile = get_profile(key)
    conf = ev.species_conf if mapped else min(ev.best.conf, 0.5)
    needs_review = conf < profile.review_threshold or key == "animal"

    started_at = captured_at + timedelta(seconds=ev.start_t)
    local = started_at.astimezone(TZ)
    duration = max(ev.end_t - ev.start_t, 1.0 / max(s.sample_fps, 0.1))

    async with db.service() as conn:
        visits_7d, visits_prev = await _history(conn, farm_id, key, started_at)
    risk = compute_risk(RiskInputs(key, video["crop"], local, duration, ev.max_individuals, visits_7d, visits_prev, conf))

    async with db.service() as conn:
        row = await db.fetch_one(conn, "select gen_random_uuid() as id")
    event_id = str(row["id"])
    base = f"{org_id}/{video_id}/events/{event_id}"

    clip = await asyncio.to_thread(
        media.cut_clip, src, ev.start_t - s.clip_padding_s, ev.end_t + s.clip_padding_s, work / f"{event_id}.mp4"
    )
    clip_path = await storage.upload("media", f"{base}/clip.mp4", clip, "video/mp4")
    frame_path = analysis.frame_paths[ev.best.frame_index]
    people = [d for d in analysis.predictions[ev.best.frame_index].detections if d.label == "human"]
    keyframe = render.render_keyframe(frame_path, ev.best.bbox, f"{common} · {int(round(conf * 100))}%", people)
    keyframe_path = await storage.upload("media", f"{base}/keyframe.jpg", keyframe, "image/jpeg")

    description = _describe(common, scientific, video["farm_name"], video["crop"], local, duration, ev.max_individuals,
                            video.get("camera_name"))
    caption = None
    if s.llm_enabled and s.vlm_captions and needs_review:
        try:
            caption = await llm.caption_image(
                keyframe,
                "Camera-trap frame from an Indian farm. In one sentence, describe the animal (likely species, "
                "count, behaviour such as feeding or passing through). Say 'uncertain' if unclear.",
            )
            caption = caption[:400]
        except Exception as exc:  # advisory only; never block the pipeline
            log.warning("caption failed: %s", exc)

    async with db.service() as conn:
        await conn.execute(
            """insert into public.events (id, org_id, video_id, farm_id, camera_id, species_key, common_name, scientific_name,
                 model_label, species_conf, started_at, start_offset_s, end_offset_s, track_ids, detection_count,
                 max_individuals, contains_people, risk_score, risk_band, risk_factors, risk_model, needs_review,
                 clip_path, keyframe_path, best_bbox, description, vlm_caption)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (event_id, org_id, video_id, farm_id, video["camera_id"], key, common, scientific, ev.species_label,
             round(conf, 4), started_at, ev.start_t, ev.end_t + 1.0 / max(s.sample_fps, 0.1), ev.track_ids,
             len(ev.detections), ev.max_individuals, ev.contains_people, risk.score, risk.band, json.dumps(risk.factors),
             risk.model, needs_review, clip_path, keyframe_path, list(ev.best.bbox), description, caption),
        )
        with_rows = [(event_id, org_id, d.t, list(d.bbox), d.label, d.conf, d.track_id) for d in ev.detections]
        async with conn.cursor() as cur:
            await cur.executemany(
                "insert into public.detections (event_id, org_id, t_offset_s, bbox, label, conf, track_id) values (%s,%s,%s,%s,%s,%s,%s)",
                with_rows,
            )

    if s.llm_enabled:
        try:
            content = description + (f" Advisory visual note: {fence_untrusted(caption)}" if caption else "")
            vec = (await llm.embed([content]))[0]
            async with db.service() as conn:
                await conn.execute(
                    "insert into public.event_embeddings (event_id, org_id, model, content, embedding) values (%s,%s,%s,%s,%s::extensions.vector)",
                    (event_id, org_id, s.embed_model, content, db.vector_literal(vec)),
                )
        except Exception as exc:
            log.warning("event embedding failed: %s", exc)

    return {"id": event_id, "species_key": key, "common": common, "conf": conf, "risk": risk, "local": local,
            "visits_7d": visits_7d, "keyframe": keyframe, "contains_people": ev.contains_people}


async def _recipients(org_id: str) -> list[dict[str, Any]]:
    async with db.service() as conn:
        return await db.fetch_all(
            conn,
            """select p.id, p.language, p.telegram_chat_id, p.notify_high_risk, p.notify_analysis
               from public.memberships m join public.profiles p on p.id = m.user_id where m.org_id = %s""",
            (org_id,),
        )


async def _raise_alerts(video: dict, created: list[dict[str, Any]]) -> None:
    org_id, farm_id = str(video["org_id"]), str(video["farm_id"])
    notify_moderate = bool((video.get("options") or {}).get("notify"))
    recipients = None
    for ev in created:
        band = ev["risk"].band
        if band == "Low" or (band == "Moderate" and not notify_moderate and ev["visits_7d"] < 2):
            continue
        title, body = notify.alert_text(lang="en", species_key=ev["species_key"], common=ev["common"], farm=video["farm_name"],
                                        local_time=ev["local"], conf=ev["conf"], band=band, score=ev["risk"].score,
                                        visits=ev["visits_7d"])
        async with db.service() as conn:
            existing = await db.fetch_one(
                conn,
                """select id, severity from public.alerts where farm_id = %s and species_key = %s and status = 'open'
                     and last_seen_at > now() - interval '12 hours' order by last_seen_at desc limit 1""",
                (farm_id, ev["species_key"]),
            )
            if existing:
                await conn.execute(
                    """update public.alerts set occurrences = occurrences + 1, last_seen_at = now(), event_id = %s, body = %s,
                         severity = case when %s = 'High' then 'High' else severity end where id = %s""",
                    (ev["id"], body, band, existing["id"]),
                )
                if existing["severity"] == "High" or band != "High":
                    continue
                alert_id = existing["id"]
            else:
                row = await db.fetch_one(
                    conn,
                    """insert into public.alerts (org_id, farm_id, event_id, video_id, species_key, title, body, severity)
                       values (%s,%s,%s,%s,%s,%s,%s,%s) returning id""",
                    (org_id, farm_id, ev["id"], video["id"], ev["species_key"], title, body, band),
                )
                alert_id = row["id"]

        if recipients is None:
            recipients = await _recipients(org_id)
        sent: list[str] = []
        for r in recipients:
            if not (r["telegram_chat_id"] and r["notify_high_risk"]):
                continue
            lang = r["language"]
            t, b = notify.alert_text(lang=lang, species_key=ev["species_key"], common=ev["common"], farm=video["farm_name"],
                                     local_time=ev["local"], conf=ev["conf"], band=band, score=ev["risk"].score,
                                     visits=ev["visits_7d"])
            buttons = [[{"text": "Prepare claim", "callback_data": f"claim:{ev['id']}"},
                        {"text": "Not an animal", "callback_data": f"reject:{ev['id']}"}]]
            photo = None if ev["contains_people"] else ev["keyframe"]
            if await notify.telegram_send(r["telegram_chat_id"], f"{t}\n\n{b}\n\n{notify.cta_text(lang)}", buttons, photo):
                sent.append(str(r["id"]))
        if sent:
            async with db.service() as conn:
                await conn.execute(
                    "update public.alerts set channels = channels || %s::jsonb where id = %s",
                    (json.dumps({"telegram": sent}), alert_id),
                )


async def _notify_done(video: dict, events: int) -> None:
    for r in await _recipients(str(video["org_id"])):
        if r["telegram_chat_id"] and r["notify_analysis"] and str(r["id"]) == str(video["uploaded_by"]):
            await notify.telegram_send(r["telegram_chat_id"], notify.analysis_done_text(r["language"], video["title"], events))
