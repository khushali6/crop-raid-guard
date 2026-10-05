"""Request authentication.

Accepts either a Supabase Auth access token (browser sessions, OAuth clients) or a personal
API key (`crg_...`) created in Settings. Both resolve to a `Principal` with an active org.
"""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass, field

import jwt
from fastapi import Depends, Header, HTTPException, status
from jwt import PyJWKClient

from app import db
from app.config import get_settings

ALL_SCOPES = ["events:read", "claims:draft", "claims:write"]
API_KEY_PREFIX = "crg_"

_jwks_client: PyJWKClient | None = None


@dataclass
class Principal:
    user_id: str
    org_id: str
    kind: str = "user"  # user | api_key
    email: str | None = None
    scopes: list[str] = field(default_factory=lambda: list(ALL_SCOPES))
    language: str = "en"

    def require(self, scope: str) -> None:
        if scope not in self.scopes:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"This credential lacks the '{scope}' scope.")


def _jwks() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        url = f"{get_settings().supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
        _jwks_client = PyJWKClient(url, cache_keys=True, lifespan=3600)
    return _jwks_client


def decode_supabase_jwt(token: str) -> dict:
    settings = get_settings()
    header = jwt.get_unverified_header(token)
    alg = header.get("alg", "")
    options = {"require": ["exp", "sub"]}
    if alg == "HS256":
        if not settings.supabase_jwt_secret:
            raise jwt.InvalidTokenError("HS256 token but SUPABASE_JWT_SECRET is not configured")
        return jwt.decode(token, settings.supabase_jwt_secret, algorithms=["HS256"], audience="authenticated", options=options)
    key = _jwks().get_signing_key_from_jwt(token)
    return jwt.decode(token, key.key, algorithms=["RS256", "ES256"], audience="authenticated", options=options)


def hash_api_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def new_api_key() -> tuple[str, str, str]:
    raw = API_KEY_PREFIX + secrets.token_urlsafe(32)
    return raw, raw[:12], hash_api_key(raw)


async def _resolve_org(user_id: str, requested_org: str | None) -> tuple[str, str]:
    async with db.service() as conn:
        profile = await db.fetch_one(conn, "select default_org_id, language from public.profiles where id = %s", (user_id,))
        org_id = requested_org or (profile or {}).get("default_org_id")
        if not org_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "No workspace found for this account.")
        member = await db.fetch_one(
            conn, "select 1 from public.memberships where org_id = %s and user_id = %s", (org_id, user_id)
        )
        if not member:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not a member of this workspace.")
        return str(org_id), (profile or {}).get("language") or "en"


async def principal_from_token(token: str, requested_org: str | None = None) -> Principal:
    if token.startswith(API_KEY_PREFIX):
        async with db.service() as conn:
            row = await db.fetch_one(
                conn,
                "update public.api_keys set last_used_at = now() where key_hash = %s and revoked_at is null"
                " returning user_id, org_id, scopes",
                (hash_api_key(token),),
            )
        if not row:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "This API key is invalid or has been revoked.")
        org_id, language = await _resolve_org(str(row["user_id"]), str(row["org_id"]))
        return Principal(str(row["user_id"]), org_id, "api_key", None, list(row["scopes"]), language)
    try:
        claims = decode_supabase_jwt(token)
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your session has expired. Please sign in again.") from exc
    user_id = claims["sub"]
    org_id, language = await _resolve_org(user_id, requested_org)
    return Principal(user_id, org_id, "user", claims.get("email"), list(ALL_SCOPES), language)


async def get_principal(
    authorization: str | None = Header(default=None),
    x_org_id: str | None = Header(default=None),
) -> Principal:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in to continue.", headers={"WWW-Authenticate": "Bearer"})
    return await principal_from_token(authorization[7:].strip(), x_org_id)


def require_scope(scope: str):
    async def dep(principal: Principal = Depends(get_principal)) -> Principal:
        principal.require(scope)
        return principal

    return dep


def require_admin_token(x_admin_token: str | None = Header(default=None)) -> None:
    expected = get_settings().admin_token
    if not expected or not x_admin_token or not secrets.compare_digest(expected, x_admin_token):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin token required.")
