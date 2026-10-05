"""Field reports: deterministic statistics + an LLM narrative grounded only in those statistics."""

from __future__ import annotations

import json
import logging
from datetime import date, timedelta
from typing import Any

from app import db, llm
from app.config import get_settings
from app.guardrails import unsupported_numbers

log = logging.getLogger(__name__)


async def compute_stats(user_id: str, org_id: str, start: date, end: date, farm_id: str | None = None, video_id: str | None = None) -> dict[str, Any]:
    p = {"org": org_id, "start": start, "end": end + timedelta(days=1), "farm": farm_id, "video": video_id}
    where = """e.org_id = %(org)s and e.review_status <> 'rejected'
               and e.started_at >= (%(start)s::date::timestamp at time zone 'Asia/Kolkata')
               and e.started_at < (%(end)s::date::timestamp at time zone 'Asia/Kolkata')
               and (%(farm)s::uuid is null or e.farm_id = %(farm)s::uuid)
               and (%(video)s::uuid is null or e.video_id = %(video)s::uuid)"""
    async with db.as_user(user_id, read_only=True) as conn:
        totals = await db.fetch_one(conn, f"""select count(*) as events, count(*) filter (where risk_band='High') as high_risk,
            count(*) filter (where risk_band='Moderate') as moderate_risk, count(distinct final_species_key) as species,
            count(distinct video_id) as videos, count(*) filter (where needs_review and review_status='pending') as pending_review,
            count(*) filter (where extract(hour from started_at at time zone 'Asia/Kolkata') >= 19
                             or extract(hour from started_at at time zone 'Asia/Kolkata') < 6) as night_events
            from public.events e where {where}""", p)
        species = await db.fetch_all(conn, f"""select final_common_name as species, count(*) as events,
            count(*) filter (where risk_band='High') as high_risk, max(risk_score) as max_risk,
            mode() within group (order by extract(hour from started_at at time zone 'Asia/Kolkata')::int) as peak_hour
            from public.events e where {where} group by 1 order by 2 desc""", p)
        farms = await db.fetch_all(conn, f"""select f.name as farm, f.crop, count(e.id) as events, coalesce(max(e.risk_score),0) as max_risk,
            public.risk_band(coalesce(max(e.risk_score),0)::int) as risk_band
            from public.farms f left join public.events e on e.farm_id = f.id and {where.replace('e.org_id = %(org)s and ', '')}
            where f.org_id = %(org)s and (%(farm)s::uuid is null or f.id = %(farm)s::uuid) group by f.id order by 3 desc""", p)
        daily = await db.fetch_all(conn, f"""select (started_at at time zone 'Asia/Kolkata')::date as day, count(*) as events,
            count(*) filter (where risk_band='High') as high_risk from public.events e where {where} group by 1 order by 1""", p)
        prev = await db.fetch_one(conn, f"""select count(*) as events from public.events e where {where.replace('%(start)s', '%(pstart)s').replace('%(end)s', '%(start)s')}""",
                                  {**p, "pstart": start - (end - start) - timedelta(days=1)})
        top = await db.fetch_all(conn, f"""select e.id, e.video_id, e.final_common_name as species, f.name as farm, e.started_at,
            e.start_offset_s, e.risk_score, e.risk_band from public.events e join public.farms f on f.id = e.farm_id
            where {where} order by e.risk_score desc, e.started_at desc limit 5""", p)
    return json.loads(json.dumps({
        "period": {"start": start.isoformat(), "end": end.isoformat()},
        "totals": totals, "previous_period_events": prev["events"], "species": species, "farms": farms,
        "daily": daily, "top_events": top,
    }, default=str))


NARRATIVE_SYSTEM = """You write calm, practical field reports for Indian farmers and FPO staff about wildlife activity.
Use ONLY numbers present in the JSON. Structure: 1) Executive summary (3-4 sentences) 2) What to watch (2-3 bullets)
3) Suggested next steps (2-3 bullets, low-cost and non-lethal). Do not claim crop damage was confirmed.
Risk scores describe activity patterns, not confirmed loss. Output markdown without a title."""


async def write_narrative(stats: dict, language: str) -> str:
    if not get_settings().llm_enabled:
        t = stats["totals"]
        return (f"{t['events']} wildlife events were recorded in this period, {t['high_risk']} of them high-risk. "
                "Narrative summaries need GEMINI_API_KEY on the server.")
    prompt = f"Language: {llm.LANGUAGE_NAMES.get(language, 'English')}.\nStatistics JSON:\n{json.dumps(stats, ensure_ascii=False)}"
    text = await llm.generate_text(prompt, system=NARRATIVE_SYSTEM, temperature=0.2)
    if unsupported_numbers(text, [stats]):
        text = await llm.generate_text(prompt + "\n\nYour previous draft contained numbers not in the JSON. Use only JSON numbers.",
                                       system=NARRATIVE_SYSTEM, temperature=0)
    return text


async def generate_report(*, user_id: str, org_id: str, kind: str = "weekly", start: date | None = None, end: date | None = None,
                          farm_id: str | None = None, video_id: str | None = None, language: str = "en", title: str | None = None) -> dict:
    end = end or date.today()
    start = start or end - timedelta(days=6)
    if video_id and not farm_id:
        async with db.as_user(user_id, read_only=True) as conn:
            v = await db.fetch_one(conn, "select farm_id, title, captured_at from public.videos where id = %s", (video_id,))
        if v:
            farm_id = str(v["farm_id"])
            start = end = v["captured_at"].date()
            title = title or f"Video summary: {v['title']}"
    stats = await compute_stats(user_id, org_id, start, end, farm_id, video_id)
    narrative = await write_narrative(stats, language)
    if not title:
        title = {"weekly": "Weekly field report", "farm": "Field wildlife summary", "video": "Video summary"}.get(kind, "Field report")
    async with db.as_user(user_id) as conn:
        row = None
        if video_id and kind == "video":
            row = await db.fetch_one(
                conn,
                """update public.reports set title = %s, period_start = %s, period_end = %s, stats = %s, narrative = %s,
                   language = %s, created_at = now()
                   where id = (select id from public.reports where video_id = %s and kind = 'video' order by created_at desc limit 1)
                   returning id""",
                (title, start, end, json.dumps(stats), narrative, language, video_id),
            )
        row = row or await db.fetch_one(
            conn,
            """insert into public.reports (org_id, created_by, kind, title, farm_id, video_id, period_start, period_end, stats, narrative, language)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning id""",
            (org_id, user_id, kind, title, farm_id, video_id, start, end, json.dumps(stats), narrative, language),
        )
    return {"id": str(row["id"]), "title": title, "stats": stats, "narrative": narrative}
