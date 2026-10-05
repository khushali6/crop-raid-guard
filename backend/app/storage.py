"""Supabase Storage client (service role). Object paths always start with the org id."""

from __future__ import annotations

from pathlib import Path
from urllib.parse import quote

import httpx

from app.config import get_settings

_client: httpx.AsyncClient | None = None


def _base() -> str:
    return f"{get_settings().supabase_url.rstrip('/')}/storage/v1"


def client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        key = get_settings().supabase_service_role_key
        _client = httpx.AsyncClient(
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=httpx.Timeout(120.0, connect=15.0),
        )
    return _client


async def close() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def _obj(path: str) -> str:
    return quote(path, safe="/")


async def download(bucket: str, path: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    async with client().stream("GET", f"{_base()}/object/{bucket}/{_obj(path)}") as resp:
        if resp.status_code != 200:
            body = await resp.aread()
            raise RuntimeError(f"storage download failed ({resp.status_code}): {body[:200]!r}")
        with dest.open("wb") as fh:
            async for chunk in resp.aiter_bytes(1 << 20):
                fh.write(chunk)
    return dest


async def download_bytes(bucket: str, path: str) -> bytes:
    resp = await client().get(f"{_base()}/object/{bucket}/{_obj(path)}")
    if resp.status_code != 200:
        raise RuntimeError(f"storage download failed ({resp.status_code})")
    return resp.content


async def upload(bucket: str, path: str, data: bytes | Path, content_type: str, upsert: bool = True) -> str:
    payload = data.read_bytes() if isinstance(data, Path) else data
    resp = await client().post(
        f"{_base()}/object/{bucket}/{_obj(path)}",
        content=payload,
        headers={"Content-Type": content_type, "x-upsert": "true" if upsert else "false", "cache-control": "3600"},
    )
    if resp.status_code not in (200, 201):
        raise RuntimeError(f"storage upload failed ({resp.status_code}): {resp.text[:200]}")
    return path


async def sign(bucket: str, path: str, expires_in: int = 3600, download_name: str | None = None) -> str:
    resp = await client().post(f"{_base()}/object/sign/{bucket}/{_obj(path)}", json={"expiresIn": expires_in})
    if resp.status_code != 200:
        raise RuntimeError(f"storage sign failed ({resp.status_code}): {resp.text[:200]}")
    url = f"{_base()}{resp.json()['signedURL']}"
    if download_name:
        url += f"&download={quote(download_name)}"
    return url


async def remove(bucket: str, paths: list[str]) -> None:
    if not paths:
        return
    resp = await client().request("DELETE", f"{_base()}/object/{bucket}", json={"prefixes": paths})
    if resp.status_code not in (200, 204):
        raise RuntimeError(f"storage delete failed ({resp.status_code}): {resp.text[:200]}")
