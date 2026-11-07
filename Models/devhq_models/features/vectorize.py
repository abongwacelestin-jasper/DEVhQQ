"""Deterministic vectorisation with an explicit, versioned column order.

The column list is written into every model's metadata; the registry refuses
to serve a model whose columns differ from what this code produces.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np
import numpy.typing as npt

from .schema import (
    KNOWN_PROVIDERS,
    NETWORKS,
    PRIORITIES,
    TASK_STATUSES,
    TASK_TYPES,
    DeployFeatures,
    SigninFeatures,
    TaskFeatures,
)

Matrix = npt.NDArray[np.float64]

TASK_COLUMNS: list[str] = [
    "estimate",
    "status_age_days",
    "age_days",
    "days_to_due",
    "blocked",
    "comments",
    "subtasks_total",
    "subtask_completion",
    "logged_hours",
    "logged_vs_estimate",
    "assignee_open_tasks",
    "assignee_throughput_30d",
    "assignee_late_rate",
    *[f"type={t}" for t in TASK_TYPES],
    *[f"priority={p}" for p in PRIORITIES],
    *[f"status={s}" for s in TASK_STATUSES],
]

DEPLOY_COLUMNS: list[str] = [
    "production",
    "hour_sin",
    "hour_cos",
    "weekday",
    "weekend",
    "off_hours",
    "requester_deploys_90d",
    "requester_failure_rate",
    "product_failure_rate_30d",
    "product_incidents_7d",
    "open_incidents",
    "log_hours_since_last_deploy",
    *[f"provider={p}" for p in (*KNOWN_PROVIDERS, "other")],
]

SIGNIN_COLUMNS: list[str] = [
    "hour_sin",
    "hour_cos",
    "weekday_sin",
    "weekday_cos",
    "log_distance_km",
    "new_device",
    "log_velocity_kmh",
    "new_country",
    *[f"network={n}" for n in NETWORKS],
]


def _onehot(value: str, options: Sequence[str]) -> list[float]:
    return [1.0 if value == o else 0.0 for o in options]


def task_vector(f: TaskFeatures) -> list[float]:
    completion = f.subtasks_done / f.subtasks_total if f.subtasks_total else 0.0
    return [
        f.estimate,
        f.status_age_days,
        f.age_days,
        f.days_to_due,
        float(f.blocked),
        float(f.comments),
        float(f.subtasks_total),
        min(completion, 1.0),
        f.logged_hours,
        f.logged_hours / f.estimate if f.estimate else 0.0,
        float(f.assignee_open_tasks),
        f.assignee_throughput_30d,
        f.assignee_late_rate,
        *_onehot(f.type, TASK_TYPES),
        *_onehot(f.priority, PRIORITIES),
        *_onehot(f.status, TASK_STATUSES),
    ]


def provider_bucket(provider: str) -> str:
    p = provider.strip().lower()
    return p if p in KNOWN_PROVIDERS else "other"


def deploy_vector(f: DeployFeatures) -> list[float]:
    angle = 2 * math.pi * f.hour_utc / 24
    return [
        1.0 if f.env == "production" else 0.0,
        math.sin(angle),
        math.cos(angle),
        float(f.weekday),
        1.0 if f.weekday >= 5 else 0.0,
        1.0 if f.hour_utc < 7 or f.hour_utc >= 19 else 0.0,
        float(f.requester_deploys_90d),
        f.requester_failure_rate,
        f.product_failure_rate_30d,
        float(f.product_incidents_7d),
        float(f.open_incidents),
        math.log1p(f.hours_since_last_deploy),
        *_onehot(provider_bucket(f.provider), (*KNOWN_PROVIDERS, "other")),
    ]


def signin_vector(f: SigninFeatures) -> list[float]:
    h = 2 * math.pi * f.hour_utc / 24
    w = 2 * math.pi * f.weekday / 7
    return [
        math.sin(h),
        math.cos(h),
        math.sin(w),
        math.cos(w),
        math.log1p(f.distance_km_from_usual),
        float(f.new_device),
        math.log1p(f.velocity_kmh),
        float(f.new_country),
        *_onehot(f.network, NETWORKS),
    ]


def matrix(rows: Sequence[list[float]], width: int) -> Matrix:
    if not rows:
        return np.zeros((0, width), dtype=np.float64)
    return np.asarray(rows, dtype=np.float64)
