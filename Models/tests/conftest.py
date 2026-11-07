from __future__ import annotations

import os

# Cap native thread pools before numpy / scikit-learn load (see training/pipeline.py).
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from devhq_models.api.app import create_app
from devhq_models.config import S3Settings, Settings
from devhq_models.features.schema import Dataset
from devhq_models.registry.registry import MODEL_NAMES, ModelRegistry
from devhq_models.registry.store import LocalStore
from devhq_models.security.hmac_auth import signed_headers
from devhq_models.training import pipeline
from devhq_models.training.synthetic import generate

TOKEN = "test-service-token-0123456789abcdef0123456789"
SEED = 11


def make_settings(model_dir: Path, **overrides: object) -> Settings:
    base: dict[str, object] = {
        "env": "test",
        "service_token": TOKEN,
        "signing_key": None,
        "max_skew_seconds": 300,
        "max_body_bytes": 8 * 1024 * 1024,
        "model_dir": model_dir,
        "s3": S3Settings(None, "us-east-1", None, None, True, None),
        "bootstrap_synthetic": False,
        "backend_url": None,
        "anthropic_api_key": None,
        "assistant_model": "claude-sonnet-5-5",
        "assistant_max_tokens": 1024,
        "assistant_timeout_seconds": 10.0,
        "assistant_fallbacks": True,
    }
    base.update(overrides)
    return Settings(**base)  # type: ignore[arg-type]


@pytest.fixture(scope="session")
def dataset() -> Dataset:
    # Smaller than the production cold-start set to keep the suite quick.
    return generate(SEED, n_tasks=1200, n_deployments=1600, n_signins=2000)


@pytest.fixture(scope="session")
def trained_dir(tmp_path_factory: pytest.TempPathFactory, dataset: Dataset) -> Path:
    """A registry directory with all four models trained on synthetic data and promoted."""
    root = tmp_path_factory.mktemp("registry")
    settings = make_settings(root)
    reg = ModelRegistry(LocalStore(root), settings.registry_key)
    results = {}
    for name in MODEL_NAMES:
        results[name] = pipeline.run(name, dataset, reg, seed=SEED)
    (root / "results.json").write_text(json.dumps(results, default=str))
    return root


@pytest.fixture(scope="session")
def train_results(trained_dir: Path) -> dict[str, dict[str, object]]:
    data: dict[str, dict[str, object]] = json.loads((trained_dir / "results.json").read_text())
    return data


def signed(
    method: str, path: str, body: object | None = None, token: str = TOKEN
) -> dict[str, object]:
    raw = b"" if body is None else json.dumps(body).encode()
    headers = signed_headers(token, method, path, raw)
    if body is not None:
        headers["Content-Type"] = "application/json"
    return {"headers": headers, "content": raw} if body is not None else {"headers": headers}


@pytest.fixture
def app_client(trained_dir: Path) -> Iterator[TestClient]:
    app = create_app(make_settings(trained_dir))
    with TestClient(app) as c:
        yield c
