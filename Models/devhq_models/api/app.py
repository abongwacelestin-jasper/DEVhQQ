"""HTTP API (internal network only). Every route except ``/health`` is HMAC-signed.

Endpoints (WAVE4 §6):
  GET  /health                      public, minimal
  POST /v1/predict/task-eta         TaskFeatures       -> ETA p10/p50/p90 (days)
  POST /v1/predict/overdue          TaskFeatures       -> calibrated P(late) + drivers
  POST /v1/predict/deploy-risk      DeployFeatures     -> calibrated P(fail) + drivers
  POST /v1/score/signin-anomaly     SigninFeatures     -> {score, reasons} like assessRisk
  POST /v1/assistant/answer         question + scoped context -> grounded answer
  POST /v1/train/{model}            synthetic | inline dataset -> metrics, promoted?
  GET  /v1/models                   metadata of the models being served
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, Literal

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from ..assistant.service import AssistantError, AssistantService, ClientFactory, default_client
from ..config import Settings, load_settings
from ..features.schema import DeployFeatures, SigninFeatures, TaskFeatures
from ..features.vectorize import (
    DEPLOY_COLUMNS,
    SIGNIN_COLUMNS,
    TASK_COLUMNS,
    deploy_vector,
    matrix,
    task_vector,
)
from ..models.explain import describe_deploy, describe_task, phrases
from ..registry.registry import MODEL_NAMES, LoadedModel, ModelRegistry, VerificationError
from ..registry.store import make_store
from ..security.hmac_auth import SignatureMiddleware
from ..training import pipeline
from ..training.synthetic import generate
from .schemas import (
    AssistantRequest,
    AssistantResponse,
    DeployRiskResponse,
    EtaOut,
    ModelInfo,
    OverdueResponse,
    SigninAnomalyResponse,
    TaskEtaResponse,
    TrainRequest,
    TrainResponse,
)

log = logging.getLogger("devhq_models.api")

EXPECTED_COLUMNS = {
    "task-eta": TASK_COLUMNS,
    "overdue": TASK_COLUMNS,
    "deploy-risk": DEPLOY_COLUMNS,
    "signin-anomaly": SIGNIN_COLUMNS,
}


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


@dataclass
class ServiceState:
    settings: Settings
    registry: ModelRegistry
    assistant: AssistantService
    models: dict[str, LoadedModel] = field(default_factory=dict)
    load_errors: dict[str, str] = field(default_factory=dict)
    train_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def load(self, name: str) -> None:
        try:
            loaded = self.registry.load_promoted(name, EXPECTED_COLUMNS[name])
        except VerificationError as e:
            # Fail closed: a model that does not verify is never served.
            log.error("refusing to load %s: %s", name, e)
            self.models.pop(name, None)
            self.load_errors[name] = str(e)
            return
        if loaded is None:
            self.load_errors[name] = "no promoted model"
            return
        self.models[name] = loaded
        self.load_errors.pop(name, None)
        log.info("serving %s %s (trained on %s)", name, loaded.version, loaded.trained_on)

    def bootstrap(self) -> None:
        """Cold start: train on SYNTHETIC data for models that have never been promoted."""
        missing = [n for n in MODEL_NAMES if self.load_errors.get(n) == "no promoted model"]
        if not missing:
            return
        log.warning("bootstrapping %s on SYNTHETIC data (not real DevHQ history)", missing)
        ds = generate()
        for name in missing:
            result = pipeline.run(name, ds, self.registry)
            if result["promoted"]:
                self.load(name)

    def require(self, name: str) -> LoadedModel:
        m = self.models.get(name)
        if m is None:
            raise ApiError(503, "model_unavailable", f"No verified {name} model is loaded")
        return m


def _info(m: LoadedModel) -> ModelInfo:
    return ModelInfo(name=m.name, version=m.version, trained_on=m.trained_on)


def create_app(
    settings: Settings | None = None,
    *,
    client_factory: ClientFactory = default_client,
    load_on_startup: bool = True,
) -> FastAPI:
    cfg = settings or load_settings()
    state = ServiceState(
        settings=cfg,
        registry=ModelRegistry(make_store(cfg.s3, cfg.model_dir), cfg.registry_key),
        assistant=AssistantService(cfg, client_factory),
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        task: asyncio.Task[None] | None = None
        if load_on_startup:
            for name in MODEL_NAMES:
                await asyncio.to_thread(state.load, name)
            if cfg.bootstrap_synthetic and cfg.registry_key:
                # In the background so /health answers while training runs.
                task = asyncio.create_task(asyncio.to_thread(state.bootstrap))
        yield
        if task is not None and not task.done():
            task.cancel()

    app = FastAPI(
        title="DevHQ ML service",
        version="1.0.0",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.svc = state
    app.add_middleware(
        SignatureMiddleware,
        token_getter=lambda: cfg.service_token,
        max_skew=cfg.max_skew_seconds,
        max_body_bytes=cfg.max_body_bytes,
    )

    @app.exception_handler(ApiError)
    async def _api_error(_: Request, e: ApiError) -> JSONResponse:
        return JSONResponse({"error": {"code": e.code, "message": e.message}}, status_code=e.status)

    @app.exception_handler(AssistantError)
    async def _assistant_error(_: Request, e: AssistantError) -> JSONResponse:
        return JSONResponse({"error": {"code": e.code, "message": e.message}}, status_code=e.status)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, e: RequestValidationError) -> JSONResponse:
        details = [
            {"loc": [str(p) for p in err.get("loc", ())], "msg": str(err.get("msg", ""))}
            for err in e.errors()[:20]
        ]
        return JSONResponse(
            {
                "error": {
                    "code": "validation_failed",
                    "message": "Invalid request",
                    "details": details,
                }
            },
            status_code=422,
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, e: StarletteHTTPException) -> JSONResponse:
        code = "not_found" if e.status_code == 404 else "http_error"
        return JSONResponse(
            {"error": {"code": code, "message": str(e.detail)}}, status_code=e.status_code
        )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/v1/models")
    async def models() -> dict[str, Any]:
        return {
            "models": {
                n: {
                    "version": m.version,
                    "trainedOn": m.trained_on,
                    "metrics": m.metadata.get("metrics", {}),
                    "createdAt": m.metadata.get("created_at"),
                    "sha256": m.metadata.get("sha256"),
                }
                for n, m in state.models.items()
            },
            "unavailable": state.load_errors,
            "assistant": {"configured": state.assistant.configured, "model": cfg.assistant_model},
            "store": state.registry.store.description,
        }

    @app.post("/v1/predict/task-eta", response_model=TaskEtaResponse)
    async def task_eta(f: TaskFeatures) -> TaskEtaResponse:
        m = state.require("task-eta")
        q = m.model.predict_quantiles(matrix([task_vector(f)], len(TASK_COLUMNS)))[0]
        return TaskEtaResponse(
            eta_days=EtaOut(
                p10=round(float(q[0]), 1), p50=round(float(q[1]), 1), p90=round(float(q[2]), 1)
            ),
            model=_info(m),
        )

    @app.post("/v1/predict/overdue", response_model=OverdueResponse)
    async def overdue(f: TaskFeatures) -> OverdueResponse:
        m = state.require("overdue")
        x = matrix([task_vector(f)], len(TASK_COLUMNS))
        p = float(m.model.predict_proba(x)[0])
        drivers = phrases([describe_task(d, f) for d in m.model.drivers(x[0])])
        return OverdueResponse(probability=round(p, 3), drivers=drivers, model=_info(m))

    @app.post("/v1/predict/deploy-risk", response_model=DeployRiskResponse)
    async def deploy_risk(f: DeployFeatures) -> DeployRiskResponse:
        m = state.require("deploy-risk")
        x = matrix([deploy_vector(f)], len(DEPLOY_COLUMNS))
        p = float(m.model.predict_proba(x)[0])
        level: Literal["low", "medium", "high"] = (
            "high" if p >= 0.35 else "medium" if p >= 0.15 else "low"
        )
        drivers = phrases([describe_deploy(d, f) for d in m.model.drivers(x[0])])
        return DeployRiskResponse(
            probability=round(p, 3),
            score=round(p * 100),
            level=level,
            drivers=drivers,
            model=_info(m),
        )

    @app.post("/v1/score/signin-anomaly", response_model=SigninAnomalyResponse)
    async def signin_anomaly(f: SigninFeatures) -> SigninAnomalyResponse:
        m = state.require("signin-anomaly")
        r = m.model.score(f)
        decision: Literal["allow", "challenge", "block"] = (
            "block" if r.score >= 70 else "challenge" if r.score >= 40 else "allow"
        )
        return SigninAnomalyResponse(
            score=r.score, reasons=r.reasons, decision=decision, model=_info(m)
        )

    @app.post("/v1/assistant/answer", response_model=AssistantResponse)
    async def assistant_answer(req: AssistantRequest) -> AssistantResponse:
        return await state.assistant.answer(req)

    @app.post("/v1/train/{model_name}", response_model=TrainResponse)
    async def train(model_name: str, req: TrainRequest) -> TrainResponse:
        if model_name not in MODEL_NAMES:
            raise ApiError(404, "not_found", f"Unknown model {model_name}")
        if req.source == "inline":
            if req.dataset is None:
                raise ApiError(
                    422, "validation_failed", "dataset is required when source is inline"
                )
            ds = req.dataset
        else:
            ds = await asyncio.to_thread(generate, req.seed)
        if state.train_lock.locked():
            raise ApiError(409, "training_in_progress", "Another training run is in progress")
        async with state.train_lock:
            result = await asyncio.to_thread(
                pipeline.run, model_name, ds, state.registry, seed=req.seed, promote=req.promote
            )
            if result["promoted"]:
                await asyncio.to_thread(state.load, model_name)
        return TrainResponse(
            name=result["name"],
            version=result["version"],
            metrics=result["metrics"],
            passed=result["passed"],
            promoted=result["promoted"],
            reasons=result["reasons"],
            trained_on=result["trainedOn"],
            sha256=result["sha256"],
        )

    return app
