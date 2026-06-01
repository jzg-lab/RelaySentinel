from __future__ import annotations

import os

from relay_sentinel.app import create_app


app = create_app(
    {
        "database_url": os.getenv("RELAY_SENTINEL_DATABASE_URL", "sqlite:///./data/relay_sentinel.db"),
        "secret_key": os.getenv("RELAY_SENTINEL_SECRET_KEY", "change-me-before-production"),
        "disable_scheduler": os.getenv("RELAY_SENTINEL_DISABLE_SCHEDULER", "true").lower()
        in {"1", "true", "yes", "on"},
        "notification_dry_run": os.getenv("RELAY_SENTINEL_NOTIFICATION_DRY_RUN", "true").lower()
        in {"1", "true", "yes", "on"},
    }
)

