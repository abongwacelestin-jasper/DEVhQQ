"""Training pipeline: time-based split, metrics, promotion gate, registry write.

A model is always *saved* (so a failed candidate can be inspected) but only
*promoted* — i.e. served — when every threshold below holds on the held-out,
later-in-time test window. Evaluating on the future, not a random shuffle,
is what catches models that only memorised the past.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

import numpy as np
from sklearn.metrics import brier_score_loss, mean_absolute_error, roc_auc_score
from threadpoolctl import threadpool_limits

from ..features.schema import FEATURE_SCHEMA_VERSION, Dataset, TaskFeatures
from ..features.vectorize import (
    DEPLOY_COLUMNS,
    SIGNIN_COLUMNS,
    TASK_COLUMNS,
    deploy_vector,
    matrix,
    task_vector,
)
from ..models.anomaly import SigninAnomalyModel
from ..models.classifier import CalibratedBoostedClassifier
from ..models.eta import QuantileEtaModel
from ..registry.registry import ModelRegistry

log = logging.getLogger("devhq_models.training")

TEST_FRACTION = 0.25

#: Promotion gate. A candidate below any of these is saved but never served.
THRESHOLDS: dict[str, dict[str, float]] = {
    "overdue": {"auc_min": 0.70, "brier_max": 0.20, "train_rows_min": 200, "test_rows_min": 50},
    "deploy-risk": {"auc_min": 0.68, "brier_max": 0.20, "train_rows_min": 200, "test_rows_min": 50},
    "task-eta": {
        "mae_days_max": 5.0,
        # Must beat the estimate-only heuristic the backend falls back to by 10%.
        "mae_vs_heuristic_max": 0.9,
        "interval_coverage_min": 0.65,
        "train_rows_min": 200,
        "test_rows_min": 50,
    },
    "signin-anomaly": {"auc_min": 0.80, "train_rows_min": 200, "test_rows_min": 50},
}

COLUMNS: dict[str, list[str]] = {
    "overdue": TASK_COLUMNS,
    "task-eta": TASK_COLUMNS,
    "deploy-risk": DEPLOY_COLUMNS,
    "signin-anomaly": SIGNIN_COLUMNS,
}


class _Timed(Protocol):
    @property
    def as_of(self) -> datetime: ...


@dataclass
class TrainOutcome:
    name: str
    model: object
    metrics: dict[str, float]
    passed: bool
    reasons: list[str] = field(default_factory=list)
    data_hash: str = ""


def heuristic_eta_days(f: TaskFeatures) -> float:
    """Estimate-only ETA, identical to the backend's fallback (integrations/ml/heuristics.ts)."""
    remaining_share = {"backlog": 1.0, "in-progress": 0.6, "review": 0.2, "done": 0.0}[f.status]
    return max(0.5, f.estimate / 6 * remaining_share + (2 if f.blocked else 0))


def time_split[T: _Timed](rows: Sequence[T]) -> tuple[list[T], list[T]]:
    ordered = sorted(rows, key=lambda r: r.as_of)
    cut = int(len(ordered) * (1 - TEST_FRACTION))
    return ordered[:cut], ordered[cut:]


def _hash_rows(rows: Sequence[Any]) -> str:
    h = hashlib.sha256()
    for r in rows:
        h.update(json.dumps(r.model_dump(mode="json"), sort_keys=True).encode())
        h.update(b"\n")
    return h.hexdigest()


def _gate(name: str, metrics: dict[str, float], n_train: int, n_test: int) -> list[str]:
    t = THRESHOLDS[name]
    fails: list[str] = []
    if n_train < t["train_rows_min"]:
        fails.append(f"only {n_train} training rows (need {int(t['train_rows_min'])})")
    if n_test < t["test_rows_min"]:
        fails.append(f"only {n_test} test rows (need {int(t['test_rows_min'])})")
    for key, bound in t.items():
        if key.endswith("_min") and not key.endswith("rows_min"):
            metric = key.removesuffix("_min")
            value = metrics.get(metric)
            if value is None or not np.isfinite(value) or value < bound:
                fails.append(f"{metric} {value} < {bound}")
        elif key.endswith("_max"):
            metric = key.removesuffix("_max")
            value = metrics.get(metric)
            if value is None or not np.isfinite(value) or value > bound:
                fails.append(f"{metric} {value} > {bound}")
    return fails


def _binary_metrics(y: np.ndarray, p: np.ndarray) -> dict[str, float]:
    if len(set(y.tolist())) < 2:
        return {"auc": float("nan"), "brier": float("nan"), "positive_rate": float(y.mean())}
    return {
        "auc": round(float(roc_auc_score(y, p)), 4),
        "brier": round(float(brier_score_loss(y, p)), 4),
        "positive_rate": round(float(y.mean()), 4),
    }


def train_overdue(ds: Dataset, seed: int) -> TrainOutcome:
    train, test = time_split(ds.tasks)
    model = CalibratedBoostedClassifier(TASK_COLUMNS, seed)
    metrics: dict[str, float] = {}
    if len(train) >= 20 and len({r.late for r in train}) == 2:
        model.fit(
            matrix([task_vector(r) for r in train], len(TASK_COLUMNS)),
            np.array([r.late for r in train]),
        )
        if test:
            p = model.predict_proba(matrix([task_vector(r) for r in test], len(TASK_COLUMNS)))
            metrics = _binary_metrics(np.array([r.late for r in test], dtype=int), p)
    fails = _gate("overdue", metrics, len(train), len(test))
    return TrainOutcome("overdue", model, metrics, not fails, fails, _hash_rows(ds.tasks))


def train_task_eta(ds: Dataset, seed: int) -> TrainOutcome:
    train, test = time_split(ds.tasks)
    model = QuantileEtaModel(TASK_COLUMNS, seed)
    metrics: dict[str, float] = {}
    if len(train) >= 20:
        model.fit(
            matrix([task_vector(r) for r in train], len(TASK_COLUMNS)),
            np.array([r.remaining_days for r in train]),
        )
        if test:
            q = model.predict_quantiles(matrix([task_vector(r) for r in test], len(TASK_COLUMNS)))
            y = np.array([r.remaining_days for r in test])
            mae = float(mean_absolute_error(y, q[:, 1]))
            base = float(mean_absolute_error(y, [heuristic_eta_days(r) for r in test]))
            metrics = {
                "mae_days": round(mae, 3),
                "heuristic_mae_days": round(base, 3),
                "mae_vs_heuristic": round(mae / base, 4) if base else float("nan"),
                "interval_coverage": round(float(np.mean((y >= q[:, 0]) & (y <= q[:, 2]))), 4),
            }
    fails = _gate("task-eta", metrics, len(train), len(test))
    return TrainOutcome("task-eta", model, metrics, not fails, fails, _hash_rows(ds.tasks))


def train_deploy_risk(ds: Dataset, seed: int) -> TrainOutcome:
    train, test = time_split(ds.deployments)
    model = CalibratedBoostedClassifier(DEPLOY_COLUMNS, seed)
    metrics: dict[str, float] = {}
    if len(train) >= 20 and len({r.failed for r in train}) == 2:
        model.fit(
            matrix([deploy_vector(r) for r in train], len(DEPLOY_COLUMNS)),
            np.array([r.failed for r in train]),
        )
        if test:
            p = model.predict_proba(matrix([deploy_vector(r) for r in test], len(DEPLOY_COLUMNS)))
            metrics = _binary_metrics(np.array([r.failed for r in test], dtype=int), p)
    fails = _gate("deploy-risk", metrics, len(train), len(test))
    return TrainOutcome("deploy-risk", model, metrics, not fails, fails, _hash_rows(ds.deployments))


def train_signin_anomaly(ds: Dataset, seed: int) -> TrainOutcome:
    train, test = time_split(ds.signins)
    model = SigninAnomalyModel(seed)
    metrics: dict[str, float] = {}
    if len(train) >= 50:
        # Unsupervised: labels are never used for fitting, only to evaluate.
        model.fit(list(train))
        labelled = [r for r in test if r.anomalous is not None]
        if labelled:
            y = np.array([bool(r.anomalous) for r in labelled], dtype=int)
            s = model.raw_scores(list(labelled))
            metrics = {
                "auc": round(float(roc_auc_score(y, s)), 4) if len(set(y)) == 2 else float("nan"),
                "labelled_test_rows": float(len(labelled)),
                "anomaly_rate": round(float(y.mean()), 4),
            }
    fails = _gate("signin-anomaly", metrics, len(train), len(test))
    return TrainOutcome("signin-anomaly", model, metrics, not fails, fails, _hash_rows(ds.signins))


TRAINERS = {
    "overdue": train_overdue,
    "task-eta": train_task_eta,
    "deploy-risk": train_deploy_risk,
    "signin-anomaly": train_signin_anomaly,
}


def run(
    name: str,
    ds: Dataset,
    registry: ModelRegistry,
    *,
    seed: int = 7,
    promote: bool = True,
) -> dict[str, Any]:
    """Train, evaluate, save, and promote only if the gate passes."""
    if name not in TRAINERS:
        raise ValueError(f"unknown model {name}")
    # OpenMP/BLAS pools default to one thread per core; on a shared host that
    # oversubscribes badly (threads spin at barriers). Training is small, so
    # cap it (ML_TRAIN_THREADS, default 1).
    with threadpool_limits(limits=int(os.environ.get("ML_TRAIN_THREADS", "1"))):
        outcome = TRAINERS[name](ds, seed)
    rows: Sequence[_Timed]
    if name in ("overdue", "task-eta"):
        rows = ds.tasks
    elif name == "deploy-risk":
        rows = ds.deployments
    else:
        rows = ds.signins
    train, test = time_split(rows)
    meta = registry.save(
        name,
        outcome.model,
        metrics=outcome.metrics,
        thresholds=THRESHOLDS[name],
        passed=outcome.passed,
        feature_columns=COLUMNS[name],
        feature_schema_version=FEATURE_SCHEMA_VERSION,
        training_data={
            "source": ds.source,
            "synthetic": ds.source == "synthetic",
            "sha256": outcome.data_hash,
            "rows": len(rows),
            "train_rows": len(train),
            "test_rows": len(test),
            "split": "time-based",
            "train_until": train[-1].as_of.isoformat() if train else None,
            "test_from": test[0].as_of.isoformat() if test else None,
        },
        seed=seed,
    )
    promoted = False
    if promote and outcome.passed:
        registry.promote(name, meta["version"])
        promoted = True
    elif not outcome.passed:
        log.warning("model %s %s not promoted: %s", name, meta["version"], outcome.reasons)
    return {
        "name": name,
        "version": meta["version"],
        "metrics": outcome.metrics,
        "passed": outcome.passed,
        "promoted": promoted,
        "reasons": outcome.reasons,
        "trainedOn": ds.source,
        "sha256": meta["sha256"],
    }
