"""Registry: hashes and signatures are verified before anything is unpickled."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from devhq_models.api.app import create_app
from devhq_models.features.vectorize import DEPLOY_COLUMNS, SIGNIN_COLUMNS, TASK_COLUMNS
from devhq_models.registry.registry import ModelRegistry, VerificationError
from devhq_models.registry.store import LocalStore

from .conftest import make_settings, signed


@pytest.fixture
def registry_copy(trained_dir: Path, tmp_path: Path) -> tuple[Path, ModelRegistry]:
    dst = tmp_path / "reg"
    shutil.copytree(trained_dir, dst)
    key = make_settings(dst).registry_key
    return dst, ModelRegistry(LocalStore(dst), key)


def _pointer(root: Path, name: str) -> dict[str, str]:
    data: dict[str, str] = json.loads((root / name / "promoted.json").read_text())
    return data


def test_load_verified_model(registry_copy: tuple[Path, ModelRegistry]) -> None:
    _, reg = registry_copy
    loaded = reg.load_promoted("overdue", TASK_COLUMNS)
    assert loaded is not None
    assert loaded.trained_on == "synthetic"
    assert loaded.metadata["training_data"]["synthetic"] is True
    assert len(loaded.metadata["sha256"]) == 64
    assert loaded.metadata["feature_schema"]["columns"] == TASK_COLUMNS


def test_tampered_artifact_is_refused(registry_copy: tuple[Path, ModelRegistry]) -> None:
    root, reg = registry_copy
    version = _pointer(root, "deploy-risk")["version"]
    artifact = root / "deploy-risk" / version / "model.joblib"
    data = bytearray(artifact.read_bytes())
    data[len(data) // 2] ^= 0xFF
    artifact.write_bytes(bytes(data))
    with pytest.raises(VerificationError, match="sha256 mismatch"):
        reg.load_promoted("deploy-risk", DEPLOY_COLUMNS)


def test_swapped_artifact_with_rewritten_hash_is_refused(
    registry_copy: tuple[Path, ModelRegistry],
) -> None:
    """An attacker who can write the bucket but not sign cannot get a pickle loaded."""
    root, reg = registry_copy
    version = _pointer(root, "overdue")["version"]
    meta_path = root / "overdue" / version / "metadata.json"
    meta = json.loads(meta_path.read_text())
    artifact = root / "overdue" / version / "model.joblib"
    artifact.write_bytes(b"not the model")
    import hashlib

    meta["sha256"] = hashlib.sha256(b"not the model").hexdigest()
    meta_path.write_text(json.dumps(meta))
    with pytest.raises(VerificationError, match="signature"):
        reg.load_promoted("overdue", TASK_COLUMNS)


def test_wrong_signing_key_is_refused(trained_dir: Path) -> None:
    reg = ModelRegistry(LocalStore(trained_dir), b"some-other-key")
    with pytest.raises(VerificationError, match="signature"):
        reg.load_promoted("signin-anomaly", SIGNIN_COLUMNS)


def test_feature_schema_mismatch_is_refused(trained_dir: Path) -> None:
    reg = ModelRegistry(LocalStore(trained_dir), make_settings(trained_dir).registry_key)
    with pytest.raises(VerificationError, match="feature schema"):
        reg.load_promoted("overdue", [*TASK_COLUMNS, "extra"])


def test_nothing_promoted_returns_none(tmp_path: Path) -> None:
    reg = ModelRegistry(LocalStore(tmp_path), b"k")
    assert reg.load_promoted("overdue", TASK_COLUMNS) is None


def test_unsafe_keys_are_rejected(tmp_path: Path) -> None:
    store = LocalStore(tmp_path)
    for bad in ("../escape", "/abs", "a/../../b"):
        with pytest.raises(ValueError):
            store.get(bad)


def test_service_refuses_to_serve_tampered_model(registry_copy: tuple[Path, ModelRegistry]) -> None:
    root, _ = registry_copy
    version = _pointer(root, "task-eta")["version"]
    (root / "task-eta" / version / "model.joblib").write_bytes(b"\x80\x04evil")
    with TestClient(create_app(make_settings(root))) as c:
        body = {
            "estimate": 8,
            "type": "bug",
            "priority": "low",
            "status": "backlog",
            "statusAgeDays": 1,
            "ageDays": 1,
            "daysToDue": 5,
            "blocked": False,
            "comments": 0,
            "subtasksTotal": 0,
            "subtasksDone": 0,
            "loggedHours": 0,
            "assigneeOpenTasks": 1,
            "assigneeThroughput30d": 1,
            "assigneeLateRate": 0.1,
        }
        r = c.post("/v1/predict/task-eta", **signed("POST", "/v1/predict/task-eta", body))
        assert r.status_code == 503
        assert r.json()["error"]["code"] == "model_unavailable"
        # Other, untampered models keep serving.
        ok = c.post("/v1/predict/overdue", **signed("POST", "/v1/predict/overdue", body))
        assert ok.status_code == 200
