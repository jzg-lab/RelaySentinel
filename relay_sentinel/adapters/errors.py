class AdapterError(Exception):
    """Base class for adapter failures."""


class AdapterAuthError(AdapterError):
    """Raised when credentials are rejected by the upstream service."""


class AdapterAuthBlockedError(AdapterAuthError):
    """Raised when login is blocked by a challenge page or protection layer."""

