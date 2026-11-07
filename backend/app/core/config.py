"""Environment-based configuration. Plain os.getenv — no extra dependency."""

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent.parent  # backend/


class Settings:
    def __init__(self) -> None:
        self.database_url = os.getenv(
            "DATABASE_URL", f"sqlite:///{BACKEND_DIR / 'aism.db'}"
        )
        self.jwt_secret = os.getenv("JWT_SECRET", "dev-secret-change-me-0123456789abcdef")
        self.jwt_expire_min = int(os.getenv("JWT_EXPIRE_MIN", "480"))
        self.cors_origins = [
            o.strip()
            for o in os.getenv(
                "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
            ).split(",")
            if o.strip()
        ]
        # Trusted ML ingestion (the bridge worker / any ML-side adapter).
        self.ml_ingest_token = os.getenv("ML_INGEST_TOKEN", "dev-ml-token-change-me")
        self.ml_events_dir = Path(
            os.getenv(
                "ML_EVENTS_DIR", str(BACKEND_DIR.parent / "machine learning" / "events")
            )
        )
        self.storage_provider = os.getenv("STORAGE_PROVIDER", "local")
        self.storage_dir = Path(os.getenv("STORAGE_DIR", str(BACKEND_DIR / "storage")))
        # LLM summarizer; empty = unavailable (never fabricated).
        self.llm_api_key = os.getenv("LLM_API_KEY", "")
        self.llm_base_url = os.getenv("LLM_BASE_URL", "")
        self.llm_model = os.getenv("LLM_MODEL", "")
        # 0 = retention not configured → the purge job does nothing.
        self.retention_days_default = int(os.getenv("RETENTION_DAYS_DEFAULT", "0"))
        self.risk_weights = self._parse_weights(
            os.getenv("RISK_WEIGHTS", "low:2,medium:8,high:20,critical:50")
        )
        self.queue_max_retries = int(os.getenv("QUEUE_MAX_RETRIES", "3"))
        self.queue_poll_s = float(os.getenv("QUEUE_POLL_S", "1.0"))
        self.download_url_ttl_s = int(os.getenv("DOWNLOAD_URL_TTL_S", "300"))
        # db (default) or redis — same interface, see services/queue.py
        self.queue_backend = os.getenv("QUEUE_BACKEND", "db")
        self.redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
        # strict by default; raise for local development/integration runs
        self.login_rate_limit = os.getenv("LOGIN_RATE_LIMIT", "5/minute")

    @staticmethod
    def _parse_weights(raw: str) -> dict[str, float]:
        weights: dict[str, float] = {}
        for pair in raw.split(","):
            key, _, val = pair.partition(":")
            weights[key.strip()] = float(val.strip())
        return weights

    @property
    def storage_is_dev_local(self) -> bool:
        return self.storage_provider == "local"


settings = Settings()
