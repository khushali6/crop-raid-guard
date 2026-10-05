"""Durable job worker over the Postgres `jobs` table.

- Leases a job with FOR UPDATE SKIP LOCKED (safe with several workers), extends the lease while running.
- Retries with exponential backoff; after max_attempts the job is dead-lettered and the user sees a clear error.
- Schedules daily retention cleanup and the Monday weekly digest.
Run standalone with `python -m app.worker` (e.g. on a GPU box or a GitHub Actions runner).
"""

from __future__ import annotations

import asyncio
import json
import logging
import socket
from datetime import UTC, date, datetime, timedelta
from typing import Any

from app import db, notify, reports, storage
from app.config import get_settings
from app.vision.pipeline import JobError, analyze_video

log = logging.getLogger(__name__)

CLAIM_SQL = """
update public.jobs set status = 'running', attempts = attempts + 1, locked_by = %(worker)s,
       locked_until = now() + make_interval(secs => %(lease)s)
where id = (
  select id from public.jobs
  where (status = 'queued' and run_after <= now()) or (status = 'running' and locked_until < now())
  order by run_after, id
  for update skip locked
  limit 1
)
returning *
"""


async def claim(worker_id: str, lease_s: int = 600) -> dict[str, Any] | None:
    async with db.service() as conn:
        return await db.fetch_one(conn, CLAIM_SQL, {"worker": worker_id, "lease": lease_s})


async def _heartbeat(job_id: int, worker_id: str, stop: asyncio.Event) -> None:
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=60)
        except TimeoutError:
            async with db.service() as conn:
                await conn.execute(
                    "update public.jobs set locked_until = now() + interval '10 minutes' where id = %s and locked_by = %s",
                    (job_id, worker_id),
                )


async def _finish(job: dict, ok: bool, error: str | None = None, user_message: str | None = None) -> None:
    async with db.service() as conn:
        if ok:
            await conn.execute(
                "update public.jobs set status = 'succeeded', finished_at = now(), last_error = null, locked_until = null where id = %s",
                (job["id"],),
            )
            return
        dead = job["attempts"] >= job["max_attempts"] or user_message is not None
        if dead:
            await conn.execute(
                "update public.jobs set status = 'dead', finished_at = now(), last_error = %s, locked_until = null where id = %s",
                (error, job["id"]),
            )
            if job["kind"] == "analyze_video" and job["video_id"]:
                await conn.execute(
                    "update public.videos set status = 'failed', stage = 'Analysis failed', error = %s where id = %s",
                    (user_message or "We could not analyse this video after several attempts. Please try uploading it again.",
                     job["video_id"]),
                )
        else:
            backoff = 30 * (2 ** (job["attempts"] - 1))
            await conn.execute(
                "update public.jobs set status = 'queued', last_error = %s, locked_until = null,"
                " run_after = now() + make_interval(secs => %s) where id = %s",
                (error, backoff, job["id"]),
            )
            if job["kind"] == "analyze_video" and job["video_id"]:
                await conn.execute(
                    "update public.videos set status = 'queued', stage = %s where id = %s",
                    (f"Retrying shortly (attempt {job['attempts'] + 1} of {job['max_attempts']})", job["video_id"]),
                )


async def run_generate_report(job: dict) -> None:
    payload = job.get("payload") or {}
    user_id = payload.get("user_id")
    if not user_id:
        return
    async with db.service() as conn:
        prof = await db.fetch_one(conn, "select language from public.profiles where id = %s", (user_id,))
    await reports.generate_report(user_id=user_id, org_id=str(job["org_id"]), kind=payload.get("kind", "video"),
                                  video_id=str(job["video_id"]) if job.get("video_id") else None,
                                  language=(prof or {}).get("language", "en"))


async def run_retention(job: dict) -> None:
    """Delete footage older than each owner's retention setting (events and evidence packs are kept)."""
    async with db.service() as conn:
        rows = await db.fetch_all(conn, """
            select v.id, v.storage_path, v.playback_path from public.videos v
            join public.organizations o on o.id = v.org_id
            join public.memberships m on m.org_id = o.id and m.role = 'owner'
            join public.profiles p on p.id = m.user_id
            where p.retention_days is not null and v.created_at < now() - make_interval(days => p.retention_days)
              and v.storage_path not like '%%/deleted'
            limit 200""")
    for r in rows:
        try:
            await storage.remove("videos", [r["storage_path"]])
            if r["playback_path"]:
                await storage.remove("media", [r["playback_path"]])
            async with db.service() as conn:
                await conn.execute(
                    "update public.videos set storage_path = storage_path || '/deleted', playback_path = null where id = %s", (r["id"],)
                )
                await db.audit(conn, org_id=None, actor_id=None, actor_kind="system", action="video.retention_delete",
                               entity="video", entity_id=str(r["id"]))
        except Exception as exc:
            log.warning("retention delete failed for %s: %s", r["id"], exc)


async def run_weekly_digest(job: dict) -> None:
    async with db.service() as conn:
        users = await db.fetch_all(conn, """select p.id, p.language, p.default_org_id, p.telegram_chat_id from public.profiles p
                                            where p.notify_weekly and p.default_org_id is not null""")
    for u in users:
        try:
            rep = await reports.generate_report(user_id=str(u["id"]), org_id=str(u["default_org_id"]), kind="weekly", language=u["language"])
            if u["telegram_chat_id"]:
                link = f"{get_settings().frontend_url.rstrip('/')}/reports/{rep['id']}"
                await notify.telegram_send(u["telegram_chat_id"], f"{rep['title']}\n\n{rep['narrative'][:3000]}\n\n{link}")
        except Exception as exc:
            log.warning("weekly digest failed for %s: %s", u["id"], exc)


HANDLERS = {
    "analyze_video": analyze_video,
    "generate_report": run_generate_report,
    "retention_cleanup": run_retention,
    "weekly_digest": run_weekly_digest,
}


async def schedule_periodic() -> None:
    today = date.today()
    async with db.service() as conn:
        await conn.execute(
            "insert into public.jobs (kind, idempotency_key) values ('retention_cleanup', %s) on conflict (idempotency_key) do nothing",
            (f"retention:{today.isoformat()}",),
        )
        if today.weekday() == 0:
            run_after = datetime.combine(today, datetime.min.time(), UTC) + timedelta(hours=2, minutes=30)  # 08:00 IST
            await conn.execute(
                "insert into public.jobs (kind, run_after, idempotency_key) values ('weekly_digest', %s, %s) on conflict (idempotency_key) do nothing",
                (run_after, f"weekly:{today.isoformat()}"),
            )


async def process_one(worker_id: str) -> bool:
    job = await claim(worker_id)
    if not job:
        return False
    handler = HANDLERS.get(job["kind"])
    log.info("job %s %s attempt %s", job["id"], job["kind"], job["attempts"])
    stop = asyncio.Event()
    hb = asyncio.create_task(_heartbeat(job["id"], worker_id, stop))
    try:
        if handler is None:
            raise JobError(f"Unknown job kind {job['kind']}")
        await handler(job)
        await _finish(job, True)
    except JobError as exc:
        log.warning("job %s failed permanently: %s", job["id"], exc)
        await _finish(job, False, str(exc), user_message=str(exc))
    except Exception as exc:
        log.exception("job %s failed", job["id"])
        await _finish(job, False, f"{type(exc).__name__}: {exc}"[:1000])
    finally:
        stop.set()
        hb.cancel()
    return True


async def run_forever(stop: asyncio.Event | None = None) -> None:
    s = get_settings()
    worker_id = f"{s.worker_id}@{socket.gethostname()}"
    stop = stop or asyncio.Event()
    last_schedule: date | None = None
    log.info("worker %s started", worker_id)
    while not stop.is_set():
        try:
            if last_schedule != date.today():
                await schedule_periodic()
                last_schedule = date.today()
            worked = await process_one(worker_id)
        except Exception:
            log.exception("worker loop error")
            worked = False
        if not worked:
            try:
                await asyncio.wait_for(stop.wait(), timeout=s.worker_poll_seconds)
            except TimeoutError:
                pass


async def drain(max_jobs: int = 50) -> int:
    """Process queued jobs then exit (used by scheduled runners)."""
    s = get_settings()
    worker_id = f"{s.worker_id}-drain@{socket.gethostname()}"
    done = 0
    while done < max_jobs and await process_one(worker_id):
        done += 1
    return done


async def _main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--drain", action="store_true", help="process queued jobs and exit")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    await db.open_pool()
    try:
        if args.drain:
            print(json.dumps({"processed": await drain()}))
        else:
            await run_forever()
    finally:
        await storage.close()
        await db.close_pool()


if __name__ == "__main__":
    asyncio.run(_main())
