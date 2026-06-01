from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class BalanceSignal:
    target_kind: str
    platform: str
    metric: str
    value: float
    unit: str
    confidence: str
    raw: dict[str, Any] = field(default_factory=dict)

