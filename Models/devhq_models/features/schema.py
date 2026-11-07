"""Feature contracts.

The Node backend computes these rows (``Backend/integrations/ml/features.ts``)
from its own records with the *same* function for online prediction and for
the training export, so training and serving cannot drift apart. This module
is the Python side of that contract: strict pydantic models (unknown fields
are rejected) and a fixed column order used to vectorise them.

No row carries a name, email, IP address or free text. Member identity, when
present at all, is an HMAC pseudonym computed by the backend.
"""

from __future__ import annotations

from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

from .camel import camel

FEATURE_SCHEMA_VERSION = 1

TaskType = Literal["feature", "bug", "design", "task"]
Priority = Literal["urgent", "high", "medium", "low"]
TaskStatus = Literal["backlog", "in-progress", "review", "done"]
Env = Literal["staging", "production"]
Network = Literal["residential", "office", "datacenter", "vpn", "tor", "loopback", "unknown"]

TASK_TYPES: tuple[TaskType, ...] = ("feature", "bug", "design", "task")
PRIORITIES: tuple[Priority, ...] = ("urgent", "high", "medium", "low")
TASK_STATUSES: tuple[TaskStatus, ...] = ("backlog", "in-progress", "review", "done")
ENVS: tuple[Env, ...] = ("staging", "production")
NETWORKS: tuple[Network, ...] = (
    "residential",
    "office",
    "datacenter",
    "vpn",
    "tor",
    "loopback",
    "unknown",
)
KNOWN_PROVIDERS: tuple[str, ...] = ("github actions", "gitlab ci", "argo cd", "jenkins", "circleci")


class Strict(BaseModel):
    model_config = ConfigDict(
        extra="forbid", alias_generator=camel, populate_by_name=True, frozen=True
    )


class TaskFeatures(Strict):
    estimate: float = Field(ge=0, le=400, description="Estimated effort in hours")
    type: TaskType
    priority: Priority
    status: TaskStatus
    status_age_days: float = Field(ge=0, le=3650)
    age_days: float = Field(ge=0, le=3650)
    days_to_due: float = Field(ge=-3650, le=3650)
    blocked: bool
    comments: int = Field(ge=0, le=100_000)
    subtasks_total: int = Field(ge=0, le=10_000)
    subtasks_done: int = Field(ge=0, le=10_000)
    logged_hours: float = Field(ge=0, le=100_000)
    assignee_open_tasks: int = Field(ge=0, le=10_000)
    assignee_throughput_30d: float = Field(ge=0, le=10_000)
    assignee_late_rate: float = Field(ge=0, le=1)


class TaskRow(TaskFeatures):
    """A training example: features as of ``as_of`` plus what happened afterwards."""

    as_of: AwareDatetime
    remaining_days: float = Field(ge=0, le=3650)
    late: bool


class DeployFeatures(Strict):
    env: Env
    provider: str = Field(min_length=1, max_length=40)
    hour_utc: int = Field(ge=0, le=23)
    weekday: int = Field(ge=0, le=6, description="0 = Monday")
    requester_deploys_90d: int = Field(ge=0, le=100_000)
    requester_failure_rate: float = Field(ge=0, le=1)
    product_failure_rate_30d: float = Field(ge=0, le=1)
    product_incidents_7d: int = Field(ge=0, le=10_000)
    open_incidents: int = Field(ge=0, le=10_000)
    hours_since_last_deploy: float = Field(ge=0, le=100_000)


class DeployRow(DeployFeatures):
    as_of: AwareDatetime
    failed: bool


class SigninFeatures(Strict):
    org: str = Field(default="default", min_length=1, max_length=64, pattern=r"^[\w.-]+$")
    hour_utc: int = Field(ge=0, le=23)
    weekday: int = Field(ge=0, le=6)
    distance_km_from_usual: float = Field(ge=0, le=25_000)
    network: Network
    new_device: bool
    velocity_kmh: float = Field(ge=0, le=1_000_000)
    new_country: bool


class SigninRow(SigninFeatures):
    as_of: AwareDatetime
    #: Weak label for evaluation only (synthetic injection, or a blocked /
    #: high-risk outcome in a real export). The model never trains on it.
    anomalous: bool | None = None


class Dataset(Strict):
    source: Literal["synthetic", "backend", "file"]
    generated_at: AwareDatetime
    feature_schema_version: int = FEATURE_SCHEMA_VERSION
    tasks: list[TaskRow] = Field(default_factory=list, max_length=500_000)
    deployments: list[DeployRow] = Field(default_factory=list, max_length=500_000)
    signins: list[SigninRow] = Field(default_factory=list, max_length=500_000)
