"""Runtime configuration, read once from the environment.

Nothing secret has a default. In production the service refuses to start
without a strong ``ML_SERVICE_TOKEN`` (fail closed); in development a missing
token makes every authenticated route answer 503 instead of running open.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_ASSISTANT_MODEL = "claude-sonnet-5-5"
MIN_TOKEN_LENGTH = 32


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if not raw:
        return default
    value = int(raw)
    if value <= 0:
        raise ValueError(f"{name} must be a positive integer")
    return value


def _secret(name: str) -> str | None:
    """Reads ``NAME`` or, in containers, the file named by ``NAME_FILE`` (compose secrets).

    Fails closed: setting both is ambiguous, and an unreadable file is an error.
    An empty file means "not configured".
    """
    direct = os.environ.get(name) or None
    path = os.environ.get(f"{name}_FILE") or None
    if direct and path:
        raise ValueError(f"Set only one of {name} and {name}_FILE")
    if path:
        value = Path(path).read_text(encoding="utf-8").strip()
        return value or None
    return direct


@dataclass(frozen=True)
class S3Settings:
    endpoint: str | None
    region: str
    access_key_id: str | None
    secret_access_key: str | None
    force_path_style: bool
    bucket: str | None

    @property
    def configured(self) -> bool:
        return bool(self.bucket and self.access_key_id and self.secret_access_key)


@dataclass(frozen=True)
class Settings:
    env: str
    service_token: str | None
    signing_key: str | None
    max_skew_seconds: int
    max_body_bytes: int
    model_dir: Path
    s3: S3Settings
    bootstrap_synthetic: bool
    backend_url: str | None
    anthropic_api_key: str | None = field(repr=False)
    assistant_model: str
    assistant_max_tokens: int
    assistant_timeout_seconds: float
    assistant_fallbacks: bool

    @property
    def is_prod(self) -> bool:
        return self.env == "production"

    @property
    def registry_key(self) -> bytes | None:
        """Signs registry metadata: MODEL_SIGNING_KEY, else derived from the service token."""
        if self.signing_key:
            return self.signing_key.encode()
        if self.service_token:
            return ("registry:" + self.service_token).encode()
        return None


def load_settings() -> Settings:
    env = os.environ.get("NODE_ENV") or os.environ.get("APP_ENV") or "development"
    token = _secret("ML_SERVICE_TOKEN")
    if env == "production" and (not token or len(token) < MIN_TOKEN_LENGTH):
        raise RuntimeError(
            f"ML_SERVICE_TOKEN must be set to at least {MIN_TOKEN_LENGTH} characters in production"
        )
    return Settings(
        env=env,
        service_token=token,
        signing_key=_secret("MODEL_SIGNING_KEY"),
        max_skew_seconds=_int("ML_MAX_SKEW_SECONDS", 300),
        max_body_bytes=_int("ML_MAX_BODY_BYTES", 8 * 1024 * 1024),
        model_dir=Path(os.environ.get("MODEL_DIR", "./.model-registry")),
        s3=S3Settings(
            endpoint=os.environ.get("S3_ENDPOINT") or None,
            region=os.environ.get("S3_REGION", "us-east-1"),
            access_key_id=_secret("S3_ACCESS_KEY_ID"),
            secret_access_key=_secret("S3_SECRET_ACCESS_KEY"),
            force_path_style=_bool("S3_FORCE_PATH_STYLE", True),
            bucket=os.environ.get("S3_BUCKET_MODELS") or None,
        ),
        # Cold start: outside production, train on clearly-labelled synthetic
        # data when no promoted model exists so the endpoints are usable.
        bootstrap_synthetic=_bool("ML_BOOTSTRAP_SYNTHETIC", env != "production"),
        backend_url=(os.environ.get("BACKEND_URL") or None),
        anthropic_api_key=_secret("ANTHROPIC_API_KEY"),
        assistant_model=os.environ.get("ASSISTANT_MODEL") or DEFAULT_ASSISTANT_MODEL,
        assistant_max_tokens=_int("ASSISTANT_MAX_TOKENS", 4096),
        assistant_timeout_seconds=float(os.environ.get("ASSISTANT_TIMEOUT_SECONDS", "25")),
        assistant_fallbacks=_bool("ASSISTANT_FALLBACKS", True),
    )
