"""SYNTHETIC cold-start data. Not real TavetaHQ data, and labelled as such everywhere.

A fresh install has no history to learn from. This generator produces
plausible task, deployment and sign-in rows from a simple hand-written causal
story (bigger, blocked, stale tasks run late; off-hours production deploys by
people with failed deploys behind them fail more; anomalous sign-ins combine
far-away locations, anonymising networks and odd hours) so the service, the
pipeline and the promotion gate can be exercised end to end.

Every dataset it returns has ``source="synthetic"``, every model trained on it
records ``training_data.synthetic = true`` in its metadata, and every API
response from such a model carries ``trainedOn: "synthetic"``. Replace with a
backend export (``devhq-models train --source backend``) once real history
exists. Metrics measured on synthetic data say the code works, not that the
model is accurate for your team.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime, timedelta

import numpy as np

from ..features.schema import (
    KNOWN_PROVIDERS,
    NETWORKS,
    PRIORITIES,
    TASK_TYPES,
    Dataset,
    DeployRow,
    Network,
    SigninRow,
    TaskRow,
    TaskStatus,
)

EPOCH = datetime(2025, 11, 1, tzinfo=UTC)
OPEN_STATUSES: tuple[TaskStatus, ...] = ("backlog", "in-progress", "review")
RISKY_NETWORKS: tuple[Network, ...] = ("tor", "datacenter", "vpn")
SPAN_DAYS = 365


def _sigmoid(z: float) -> float:
    return 1.0 / (1.0 + math.exp(-z))


def _when(rng: np.random.Generator) -> datetime:
    return EPOCH + timedelta(days=float(rng.uniform(0, SPAN_DAYS)))


def synthetic_tasks(rng: np.random.Generator, n: int) -> list[TaskRow]:
    n_assignees = 14
    speed = rng.lognormal(0.0, 0.3, n_assignees)
    late_rate = np.clip(rng.beta(2, 5, n_assignees), 0, 1)
    progress_of = {"backlog": 0.0, "in-progress": 0.4, "review": 0.85}
    prio_factor = {"urgent": 0.7, "high": 0.85, "medium": 1.0, "low": 1.25}
    rows: list[TaskRow] = []
    for _ in range(n):
        a = int(rng.integers(n_assignees))
        ttype = TASK_TYPES[int(rng.choice(4, p=[0.4, 0.3, 0.1, 0.2]))]
        prio = PRIORITIES[int(rng.choice(4, p=[0.08, 0.27, 0.45, 0.2]))]
        status = OPEN_STATUSES[int(rng.choice(3, p=[0.35, 0.45, 0.2]))]
        estimate = float(np.clip(round(rng.lognormal(math.log(8), 0.6)), 1, 40))
        blocked = bool(rng.random() < 0.12)
        status_age = float(rng.exponential(3.0))
        age = status_age + float(rng.exponential(5.0))
        subtasks = int(rng.poisson(2))
        progress = progress_of[status]
        done = int(rng.binomial(subtasks, min(progress + 0.1, 1.0))) if subtasks else 0
        if subtasks:
            progress = 0.5 * progress + 0.5 * done / subtasks
        logged = round(float(estimate * progress * rng.uniform(0.6, 1.4)), 1)
        open_tasks = int(rng.poisson(4))
        throughput = float(rng.poisson(6 * speed[a]))
        days_to_due = round(float(rng.normal(estimate / 4 + 3, 4)), 1)
        stale = 1 + 0.08 * min(status_age, 15)
        remaining = (estimate / 5) * (1 - progress) / speed[a] * prio_factor[prio] * (
            1 + 1.5 * blocked
        ) * (1 + 0.06 * open_tasks) * stale * (1 + 0.6 * late_rate[a]) * float(
            rng.lognormal(0, 0.35)
        ) + 0.3
        remaining = round(float(min(remaining, 120.0)), 2)
        rows.append(
            TaskRow(
                as_of=_when(rng),
                estimate=estimate,
                type=ttype,
                priority=prio,
                status=status,
                status_age_days=round(status_age, 2),
                age_days=round(age, 2),
                days_to_due=days_to_due,
                blocked=blocked,
                comments=int(rng.poisson(2 + (ttype == "bug"))),
                subtasks_total=subtasks,
                subtasks_done=done,
                logged_hours=logged,
                assignee_open_tasks=open_tasks,
                assignee_throughput_30d=throughput,
                assignee_late_rate=round(float(late_rate[a]), 3),
                remaining_days=remaining,
                late=remaining > days_to_due,
            )
        )
    return rows


def synthetic_deployments(rng: np.random.Generator, n: int) -> list[DeployRow]:
    n_requesters = 10
    skill_fail = np.clip(rng.beta(2, 9, n_requesters), 0, 1)
    providers = [p.title() for p in KNOWN_PROVIDERS]
    rows: list[DeployRow] = []
    for _ in range(n):
        r = int(rng.integers(n_requesters))
        prod = bool(rng.random() < 0.4)
        off = rng.random() < 0.12
        hour = int(rng.integers(0, 24)) if off else int(np.clip(round(rng.normal(14, 2.5)), 7, 18))
        weekday = int(rng.integers(5, 7)) if rng.random() < 0.07 else int(rng.integers(0, 5))
        deploys = int(rng.poisson(15))
        product_fail = float(np.clip(rng.beta(2, 12), 0, 1))
        incidents = int(rng.poisson(0.5))
        open_inc = int(rng.poisson(0.3))
        since = float(rng.exponential(30))
        logit = (
            -4.9
            + 0.9 * prod
            + 1.5 * (hour < 7 or hour >= 19)
            + 1.1 * (weekday >= 5)
            + 8.0 * skill_fail[r]
            + 7.0 * product_fail
            + 0.5 * incidents
            + 0.9 * open_inc
            - 0.2 * math.log1p(deploys)
            + 0.15 * math.log1p(since)
        )
        rows.append(
            DeployRow(
                as_of=_when(rng),
                env="production" if prod else "staging",
                provider=providers[int(rng.choice(len(providers), p=[0.6, 0.15, 0.1, 0.1, 0.05]))],
                hour_utc=hour,
                weekday=weekday,
                requester_deploys_90d=deploys,
                requester_failure_rate=round(
                    float(np.clip(skill_fail[r] + rng.normal(0, 0.03), 0, 1)), 3
                ),
                product_failure_rate_30d=round(product_fail, 3),
                product_incidents_7d=incidents,
                open_incidents=open_inc,
                hours_since_last_deploy=round(since, 1),
                failed=bool(rng.random() < _sigmoid(logit)),
            )
        )
    return rows


def synthetic_signins(
    rng: np.random.Generator, n: int, anomaly_rate: float = 0.03
) -> list[SigninRow]:
    orgs = (("default", 0.8, 9.0), ("acme", 0.2, 15.0))  # (name, share, typical start hour UTC)
    rows: list[SigninRow] = []
    normal_nets = [NETWORKS.index(x) for x in ("residential", "office", "vpn", "unknown")]
    for _ in range(n):
        org, _share, start = orgs[0] if rng.random() < orgs[0][1] else orgs[1]
        if rng.random() < anomaly_rate:
            kinds = rng.choice(5, size=int(rng.integers(2, 5)), replace=False)
            dist = float(rng.uniform(3000, 12000)) if 0 in kinds else float(rng.exponential(30))
            hours_gap = float(rng.uniform(0.5, 6)) if 1 in kinds else float(rng.exponential(20) + 1)
            net: Network = RISKY_NETWORKS[int(rng.integers(3))] if 2 in kinds else "residential"
            hour = (
                int((start + 12 + rng.integers(-3, 4)) % 24)
                if 3 in kinds
                else int((start + rng.normal(2, 2)) % 24)
            )
            rows.append(
                SigninRow(
                    as_of=_when(rng),
                    org=org,
                    hour_utc=hour,
                    weekday=int(rng.integers(0, 7)),
                    distance_km_from_usual=round(dist, 1),
                    network=net,
                    new_device=bool(4 in kinds or rng.random() < 0.5),
                    velocity_kmh=round(dist / hours_gap, 1),
                    new_country=bool(dist > 2500),
                    anomalous=True,
                )
            )
            continue
        dist = float(rng.exponential(30))
        gap = float(rng.exponential(20) + 1)
        rows.append(
            SigninRow(
                as_of=_when(rng),
                org=org,
                hour_utc=int((start + rng.normal(2, 2)) % 24),
                weekday=int(rng.integers(5, 7)) if rng.random() < 0.05 else int(rng.integers(0, 5)),
                distance_km_from_usual=round(dist, 1),
                network=NETWORKS[normal_nets[int(rng.choice(4, p=[0.55, 0.38, 0.05, 0.02]))]],
                new_device=bool(rng.random() < 0.08),
                velocity_kmh=round(dist / gap, 1),
                new_country=bool(rng.random() < 0.01),
                anomalous=False,
            )
        )
    return rows


def generate(
    seed: int = 7, n_tasks: int = 2400, n_deployments: int = 2400, n_signins: int = 4000
) -> Dataset:
    rng = np.random.default_rng(seed)
    return Dataset(
        source="synthetic",
        generated_at=EPOCH + timedelta(days=SPAN_DAYS),
        tasks=synthetic_tasks(rng, n_tasks),
        deployments=synthetic_deployments(rng, n_deployments),
        signins=synthetic_signins(rng, n_signins),
    )
