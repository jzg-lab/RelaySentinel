from __future__ import annotations

import os

from relay_sentinel.app import create_app


def _env_enabled(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).lower() in {"1", "true", "yes", "on"}


def _required_secret_key() -> str:
    secret_key = os.getenv("RELAY_SENTINEL_SECRET_KEY")
    if secret_key:
        return secret_key
    if _env_enabled("RELAY_SENTINEL_ALLOW_INSECURE_DEFAULTS"):
        return "change-me-before-production"
    raise RuntimeError(
        "RELAY_SENTINEL_SECRET_KEY must be set. "
        "Use RELAY_SENTINEL_ALLOW_INSECURE_DEFAULTS=true only for local development."
    )


app = create_app(
    {
        "database_url": os.getenv("RELAY_SENTINEL_DATABASE_URL", "sqlite:///./data/relay_sentinel.db"),
        "secret_key": _required_secret_key(),
        "api_key": os.getenv("RELAY_SENTINEL_API_KEY"),
        "disable_scheduler": _env_enabled("RELAY_SENTINEL_DISABLE_SCHEDULER", "true"),
        "scheduler_tick_seconds": int(os.getenv("RELAY_SENTINEL_SCHEDULER_TICK_SECONDS", "60")),
        "notification_dry_run": _env_enabled("RELAY_SENTINEL_NOTIFICATION_DRY_RUN", "true"),
    }
)
