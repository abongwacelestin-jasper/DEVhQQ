"""HMAC authentication and schema validation on the HTTP API."""

from __future__ import annotations

import json
import time

from fastapi.testclient import TestClient

from devhq_models.api.app import create_app
from devhq_models.security.hmac_auth import sign

from .conftest import TOKEN, make_settings, signed

TASK = {
    "estimate": 8,
    "type": "feature",
    "priority": "high",
    "status": "in-progress",
    "statusAgeDays": 2,
    "ageDays": 6,
    "daysToDue": 3,
    "blocked": False,
    "comments": 2,
    "subtasksTotal": 3,
    "subtasksDone": 1,
    "loggedHours": 3,
    "assigneeOpenTasks": 4,
    "assigneeThroughput30d": 5,
    "assigneeLateRate": 0.2,
}


def test_signature_matches_cross_language_vector() -> None:
    # Same vector is asserted in Backend/scripts/smoke.ts (Node signer).
    assert (
        sign(
            "devhq-test-vector-token",
            "1700000000",
            "00112233445566778899aabbccddeeff",
            "POST",
            "/v1/predict/overdue",
            b'{"estimate":8}',
        )
        == "v1=d7856a999027e2ace3c8110c1cb32f8322cfb48b19efc4e5b3499a9f2ae32e83"
    )


def test_health_is_public_and_minimal(app_client: TestClient) -> None:
    r = app_client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_unsigned_request_is_401_even_with_invalid_body(app_client: TestClient) -> None:
    # Auth runs before parsing: an anonymous caller never sees schema errors.
    r = app_client.post("/v1/predict/overdue", json={"nonsense": True})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthenticated"
    assert app_client.get("/v1/models").status_code == 401


def test_wrong_token_is_401(app_client: TestClient) -> None:
    r = app_client.post(
        "/v1/predict/overdue", **signed("POST", "/v1/predict/overdue", TASK, token="x" * 40)
    )
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "bad_signature"


def test_tampered_body_is_401(app_client: TestClient) -> None:
    req = signed("POST", "/v1/predict/overdue", TASK)
    req["content"] = json.dumps({**TASK, "estimate": 40}).encode()
    r = app_client.post("/v1/predict/overdue", **req)
    assert r.status_code == 401


def test_expired_timestamp_is_401(app_client: TestClient) -> None:
    ts = str(int(time.time()) - 301)
    nonce = "a" * 32
    body = json.dumps(TASK).encode()
    headers = {
        "X-DevHQ-Timestamp": ts,
        "X-DevHQ-Nonce": nonce,
        "X-DevHQ-Signature": sign(TOKEN, ts, nonce, "POST", "/v1/predict/overdue", body),
        "Content-Type": "application/json",
    }
    r = app_client.post("/v1/predict/overdue", headers=headers, content=body)
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "signature_expired"


def test_replayed_request_is_401(app_client: TestClient) -> None:
    req = signed("POST", "/v1/predict/overdue", TASK)
    first = app_client.post("/v1/predict/overdue", **req)
    again = app_client.post("/v1/predict/overdue", **req)
    assert first.status_code == 200
    assert again.status_code == 401
    assert again.json()["error"]["code"] == "replayed"


def test_signed_but_invalid_body_is_422(app_client: TestClient) -> None:
    bad = {**TASK, "priority": "whenever"}
    r = app_client.post("/v1/predict/overdue", **signed("POST", "/v1/predict/overdue", bad))
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_failed"


def test_unknown_fields_are_rejected(app_client: TestClient) -> None:
    smuggled = {**TASK, "assigneeEmail": "someone@example.com"}
    r = app_client.post("/v1/predict/overdue", **signed("POST", "/v1/predict/overdue", smuggled))
    assert r.status_code == 422


def test_missing_token_fails_closed(tmp_path) -> None:  # type: ignore[no-untyped-def]
    app = create_app(make_settings(tmp_path, service_token=None), load_on_startup=False)
    with TestClient(app) as c:
        r = c.post("/v1/predict/overdue", **signed("POST", "/v1/predict/overdue", TASK))
        assert r.status_code == 503
        assert r.json()["error"]["code"] == "integration_unconfigured"
        assert c.get("/health").status_code == 200


def test_predictions_with_valid_signature(app_client: TestClient) -> None:
    eta = app_client.post(
        "/v1/predict/task-eta", **signed("POST", "/v1/predict/task-eta", TASK)
    ).json()
    assert eta["etaDays"]["p10"] <= eta["etaDays"]["p50"] <= eta["etaDays"]["p90"]
    assert eta["model"]["trainedOn"] == "synthetic"

    od = app_client.post(
        "/v1/predict/overdue", **signed("POST", "/v1/predict/overdue", TASK)
    ).json()
    assert 0 <= od["probability"] <= 1
    assert isinstance(od["drivers"], list)

    deploy = {
        "env": "production",
        "provider": "GitHub Actions",
        "hourUtc": 23,
        "weekday": 6,
        "requesterDeploys90d": 2,
        "requesterFailureRate": 0.5,
        "productFailureRate30d": 0.4,
        "productIncidents7d": 2,
        "openIncidents": 1,
        "hoursSinceLastDeploy": 400,
    }
    risky = app_client.post(
        "/v1/predict/deploy-risk", **signed("POST", "/v1/predict/deploy-risk", deploy)
    ).json()
    calm = {
        **deploy,
        "env": "staging",
        "hourUtc": 14,
        "weekday": 2,
        "requesterFailureRate": 0.02,
        "productFailureRate30d": 0.02,
        "productIncidents7d": 0,
        "openIncidents": 0,
        "requesterDeploys90d": 40,
    }
    safe = app_client.post(
        "/v1/predict/deploy-risk", **signed("POST", "/v1/predict/deploy-risk", calm)
    ).json()
    assert risky["probability"] > safe["probability"]
    assert risky["level"] in {"medium", "high"}
    assert risky["drivers"], "a risky deploy should come with reasons"

    models = app_client.get("/v1/models", **signed("GET", "/v1/models")).json()
    assert set(models["models"]) == {"task-eta", "overdue", "deploy-risk", "signin-anomaly"}


def test_unknown_train_target_is_404(app_client: TestClient) -> None:
    r = app_client.post(
        "/v1/train/everything", **signed("POST", "/v1/train/everything", {"source": "synthetic"})
    )
    assert r.status_code == 404
