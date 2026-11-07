"""Request/response models for the HTTP API (camelCase on the wire, unknown fields rejected)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ..features.camel import camel
from ..features.schema import Dataset


class Wire(BaseModel):
    model_config = ConfigDict(extra="forbid", alias_generator=camel, populate_by_name=True)


class ModelInfo(Wire):
    name: str
    version: str
    trained_on: str


class EtaOut(Wire):
    p10: float
    p50: float
    p90: float


class TaskEtaResponse(Wire):
    eta_days: EtaOut
    model: ModelInfo


class OverdueResponse(Wire):
    probability: float
    drivers: list[str]
    model: ModelInfo


class DeployRiskResponse(Wire):
    probability: float
    score: int
    level: Literal["low", "medium", "high"]
    drivers: list[str]
    model: ModelInfo


class SigninAnomalyResponse(Wire):
    score: int
    reasons: list[str]
    decision: Literal["allow", "challenge", "block"]
    model: ModelInfo


class TrainRequest(Wire):
    source: Literal["synthetic", "inline"]
    dataset: Dataset | None = None
    seed: int = Field(default=7, ge=0, le=2**31 - 1)
    promote: bool = True


class TrainResponse(Wire):
    name: str
    version: str
    metrics: dict[str, float]
    passed: bool
    promoted: bool
    reasons: list[str]
    trained_on: str
    sha256: str


class ContextItem(Wire):
    id: str = Field(pattern=r"^[\w:.\-]{1,100}$")
    kind: Literal["doc", "task", "incident", "deployment"]
    title: str = Field(max_length=300)
    text: str = Field(max_length=20_000)
    url: str | None = Field(default=None, max_length=300, pattern=r"^/[\w/.\-?=&%#]*$")


class AssistantRequest(Wire):
    question: str = Field(min_length=1, max_length=2000)
    context: list[ContextItem] = Field(default_factory=list, max_length=300)


class SourceOut(Wire):
    id: str
    kind: str
    title: str
    url: str | None = None


class AssistantResponse(Wire):
    answer: str
    sources: list[SourceOut]
    model: str
    stop_reason: str | None
    grounded: bool
    truncated: bool = False


class ErrorBody(Wire):
    code: str
    message: str


class ErrorResponse(Wire):
    error: ErrorBody
