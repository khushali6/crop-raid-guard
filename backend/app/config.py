from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: str = "development"
    public_api_url: str = "http://localhost:8000"
    cors_origins: str = "http://localhost:8080,http://localhost:3000,http://localhost:5173"

    # Supabase
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""
    database_url: str = ""
    db_pool_max: int = 6

    # LLM (Gemini free tier by default)
    gemini_api_key: str = ""
    llm_model: str = "gemini-flash-latest"
    llm_router_model: str = "gemini-flash-lite-latest"
    embed_model: str = "gemini-embedding-001"
    embed_dim: int = 768
    # Paid-equivalent prices (USD per 1M tokens) used to report cost per run; the free tier bills $0.
    llm_price_in: float = 0.30
    llm_price_out: float = 2.50

    # Agents
    agent_max_steps: int = 6
    agent_daily_run_limit: int = 80
    rag_min_score: float = 0.012
    rag_min_dense: float = 0.55
    reranker: str = "auto"
    reranker_model: str = "BAAI/bge-reranker-base"
    kb_autoload: bool = True

    # Worker / vision
    worker_enabled: bool = True
    worker_poll_seconds: float = 3.0
    worker_id: str = Field(default="worker-1")
    vision_backend: str = "speciesnet"
    speciesnet_model: str = "kaggle:google/speciesnet/pyTorch/v4.0.3a/1"
    country_code: str = "IND"
    admin1_region: str | None = None
    sample_fps: float = 1.0
    max_frames: int = 360
    # MegaDetector letterbox size (multiple of 64): 512 is ~6x faster than the stock 1280 on CPU with
    # near-identical confidence for animals that fill a reasonable part of a farm camera frame.
    detector_img_size: int = 512
    # Detect on every Nth sampled frame first; skipped frames are only run at arrivals/departures.
    detect_stride: int = 2
    # Species classification runs on at most this many key frames per video; other frames inherit
    # the label of the nearest classified frame.
    max_classify_frames: int = 8
    vision_warmup: bool = True
    motion_threshold: float = 0.3
    keepalive_every_s: float = 10.0
    event_gap_s: float = 30.0
    detection_threshold: float = 0.2
    clip_padding_s: float = 2.0
    vlm_captions: bool = True

    # Evidence signing (Ed25519 seed, base64). Generate with `python -m app.evidence keygen`.
    evidence_signing_key: str = ""
    evidence_key_id: str = "crg-ed25519-1"

    # Messaging
    telegram_bot_token: str = ""
    telegram_bot_username: str = ""
    telegram_webhook_secret: str = ""
    whatsapp_token: str = ""
    whatsapp_phone_number_id: str = ""
    whatsapp_verify_token: str = ""
    whatsapp_app_secret: str = ""

    # Operations
    admin_token: str = ""
    frontend_url: str = "http://localhost:8080"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def llm_enabled(self) -> bool:
        return bool(self.gemini_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
