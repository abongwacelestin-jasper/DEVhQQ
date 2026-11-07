"""Versioned model registry with verified loading.

Layout (in the ``models`` bucket, or the local fallback directory)::

    <name>/<version>/model.joblib     the pickled model
    <name>/<version>/metadata.json    sha256, metrics, feature schema, data hash, signature
    <name>/promoted.json              {"version", "sha256", "signature"} — what serves traffic

Loading is fail-closed. ``joblib.load`` executes code from the pickle, so a
model is only unpickled when **all** of these hold:

1. the promotion pointer's HMAC signature verifies,
2. the metadata's HMAC signature verifies and names the same sha256,
3. the artifact bytes hash to exactly that sha256,
4. the metadata's feature columns equal what this code computes, and
5. it was trained with the same scikit-learn major.minor.

Signatures use ``MODEL_SIGNING_KEY`` (or a key derived from
``ML_SERVICE_TOKEN``), so write access to the bucket alone is not enough to
get code executed in this service.
"""

from __future__ import annotations

import hashlib
import hmac
import io
import json
import logging
import platform
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import joblib
import sklearn

from .store import ObjectStore

log = logging.getLogger("devhq_models.registry")

MODEL_NAMES = ("task-eta", "overdue", "deploy-risk", "signin-anomaly")


class VerificationError(Exception):
    """An artifact or its metadata failed verification. Never load it."""


@dataclass(frozen=True)
class LoadedModel:
    name: str
    version: str
    model: Any
    metadata: dict[str, Any]

    @property
    def trained_on(self) -> str:
        data = self.metadata.get("training_data", {})
        return "synthetic" if data.get("synthetic") else str(data.get("source", "unknown"))


def _canonical(obj: dict[str, Any]) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str).encode()


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sklearn_minor(v: str) -> str:
    return ".".join(v.split(".")[:2])


class ModelRegistry:
    def __init__(self, store: ObjectStore, signing_key: bytes | None) -> None:
        self.store = store
        self._key = signing_key

    # ── signing ──────────────────────────────────────────────────
    def _sign(self, payload: dict[str, Any]) -> str:
        if not self._key:
            raise VerificationError("no registry signing key configured")
        return hmac.new(self._key, _canonical(payload), hashlib.sha256).hexdigest()

    def _verify_signed(self, doc: dict[str, Any], what: str) -> dict[str, Any]:
        sig = doc.get("signature")
        body = {k: v for k, v in doc.items() if k != "signature"}
        if not isinstance(sig, str) or not hmac.compare_digest(self._sign(body), sig):
            raise VerificationError(f"{what} signature does not verify")
        return body

    def _read_json(self, key: str) -> dict[str, Any] | None:
        raw = self.store.get(key)
        if raw is None:
            return None
        try:
            doc = json.loads(raw)
        except json.JSONDecodeError as e:
            raise VerificationError(f"{key} is not valid JSON") from e
        if not isinstance(doc, dict):
            raise VerificationError(f"{key} is not a JSON object")
        return doc

    # ── writing ──────────────────────────────────────────────────
    def save(
        self,
        name: str,
        model: object,
        *,
        metrics: dict[str, float],
        thresholds: dict[str, Any],
        passed: bool,
        feature_columns: list[str],
        feature_schema_version: int,
        training_data: dict[str, Any],
        seed: int,
    ) -> dict[str, Any]:
        if name not in MODEL_NAMES:
            raise ValueError(f"unknown model {name}")
        buf = io.BytesIO()
        joblib.dump(model, buf, compress=3)
        artifact = buf.getvalue()
        digest = sha256_hex(artifact)
        now = datetime.now(UTC)
        version = f"{now.strftime('%Y%m%dT%H%M%SZ')}-{digest[:8]}"
        metadata: dict[str, Any] = {
            "name": name,
            "version": version,
            "created_at": now.isoformat(),
            "artifact": f"{name}/{version}/model.joblib",
            "sha256": digest,
            "size_bytes": len(artifact),
            "metrics": metrics,
            "thresholds": thresholds,
            "passed_thresholds": passed,
            "feature_schema": {"version": feature_schema_version, "columns": feature_columns},
            "training_data": training_data,
            "seed": seed,
            "runtime": {
                "python": platform.python_version(),
                "sklearn": sklearn.__version__,
            },
        }
        metadata["signature"] = self._sign(metadata)
        self.store.put(metadata["artifact"], artifact, "application/octet-stream")
        self.store.put(f"{name}/{version}/metadata.json", _canonical(metadata), "application/json")
        return metadata

    def promote(self, name: str, version: str) -> None:
        meta = self._read_json(f"{name}/{version}/metadata.json")
        if meta is None:
            raise VerificationError(f"{name}/{version} does not exist")
        body = self._verify_signed(meta, "metadata")
        if not body.get("passed_thresholds"):
            raise VerificationError(f"{name}/{version} is below the promotion thresholds")
        pointer: dict[str, Any] = {
            "name": name,
            "version": version,
            "sha256": body["sha256"],
            "promoted_at": datetime.now(UTC).isoformat(),
        }
        pointer["signature"] = self._sign(pointer)
        self.store.put(f"{name}/promoted.json", _canonical(pointer), "application/json")

    # ── reading ──────────────────────────────────────────────────
    def load_promoted(self, name: str, expected_columns: list[str]) -> LoadedModel | None:
        """The promoted model, verified. None when nothing is promoted yet."""
        pointer_doc = self._read_json(f"{name}/promoted.json")
        if pointer_doc is None:
            return None
        pointer = self._verify_signed(pointer_doc, "promotion pointer")
        version = str(pointer["version"])
        meta_doc = self._read_json(f"{name}/{version}/metadata.json")
        if meta_doc is None:
            raise VerificationError(f"{name}/{version} metadata is missing")
        meta = self._verify_signed(meta_doc, "metadata")
        if meta.get("sha256") != pointer.get("sha256") or meta.get("name") != name:
            raise VerificationError("promotion pointer and metadata disagree")
        if meta["feature_schema"]["columns"] != expected_columns:
            raise VerificationError("feature schema differs from this service's feature code")
        if _sklearn_minor(meta["runtime"]["sklearn"]) != _sklearn_minor(sklearn.__version__):
            raise VerificationError(
                f"trained with sklearn {meta['runtime']['sklearn']}, running {sklearn.__version__}"
            )
        artifact = self.store.get(str(meta["artifact"]))
        if artifact is None:
            raise VerificationError(f"{meta['artifact']} is missing")
        actual = sha256_hex(artifact)
        if not hmac.compare_digest(actual, str(meta["sha256"])):
            raise VerificationError(f"{name}/{version} artifact sha256 mismatch — refusing to load")
        model = joblib.load(io.BytesIO(artifact))  # verified above; see module docstring
        return LoadedModel(name=name, version=version, model=model, metadata=meta)
