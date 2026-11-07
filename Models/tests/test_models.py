"""Each model trains on synthetic data, clears its metric floor, and is deterministic."""

from __future__ import annotations

from datetime import UTC, datetime

import numpy as np
import pytest

from devhq_models.features.schema import Dataset, SigninFeatures
from devhq_models.features.vectorize import TASK_COLUMNS, matrix, task_vector
from devhq_models.models.anomaly import SigninAnomalyModel
from devhq_models.models.classifier import CalibratedBoostedClassifier
from devhq_models.training import pipeline
from devhq_models.training.synthetic import generate


@pytest.mark.parametrize("name", ["overdue", "task-eta", "deploy-risk", "signin-anomaly"])
def test_model_clears_promotion_floor(
    train_results: dict[str, dict[str, object]], name: str
) -> None:
    r = train_results[name]
    assert r["passed"] is True, r["reasons"]
    assert r["promoted"] is True
    assert r["trainedOn"] == "synthetic"


def test_metric_values(train_results: dict[str, dict[str, object]]) -> None:
    od = train_results["overdue"]["metrics"]
    assert isinstance(od, dict)
    assert od["auc"] >= 0.70 and od["brier"] <= 0.20
    dr = train_results["deploy-risk"]["metrics"]
    assert isinstance(dr, dict)
    assert dr["auc"] >= 0.68 and dr["brier"] <= 0.20
    eta = train_results["task-eta"]["metrics"]
    assert isinstance(eta, dict)
    assert eta["mae_days"] <= 5 and eta["mae_vs_heuristic"] <= 0.9
    assert eta["interval_coverage"] >= 0.65
    sa = train_results["signin-anomaly"]["metrics"]
    assert isinstance(sa, dict)
    assert sa["auc"] >= 0.80


def test_synthetic_generator_is_deterministic_and_labelled() -> None:
    a = generate(3, n_tasks=50, n_deployments=50, n_signins=60)
    b = generate(3, n_tasks=50, n_deployments=50, n_signins=60)
    assert a == b
    assert a.source == "synthetic"
    assert generate(4, n_tasks=50, n_deployments=50, n_signins=60) != a


def test_classifier_training_is_deterministic(dataset: Dataset) -> None:
    rows = dataset.tasks[:500]
    x = matrix([task_vector(r) for r in rows], len(TASK_COLUMNS))
    y = np.array([r.late for r in rows])
    p1 = CalibratedBoostedClassifier(TASK_COLUMNS, seed=5).fit(x, y).predict_proba(x[:20])
    p2 = CalibratedBoostedClassifier(TASK_COLUMNS, seed=5).fit(x, y).predict_proba(x[:20])
    assert np.array_equal(p1, p2)


def test_time_split_tests_on_the_future(dataset: Dataset) -> None:
    train, test = pipeline.time_split(dataset.tasks)
    assert max(r.as_of for r in train) <= min(r.as_of for r in test)
    assert len(test) == pytest.approx(len(dataset.tasks) * pipeline.TEST_FRACTION, abs=1)


def test_gate_refuses_a_model_trained_on_noise(dataset: Dataset, tmp_path) -> None:  # type: ignore[no-untyped-def]
    from devhq_models.registry.registry import ModelRegistry
    from devhq_models.registry.store import LocalStore

    rng = np.random.default_rng(0)
    noisy = dataset.model_copy(
        update={
            "deployments": [
                r.model_copy(update={"failed": bool(rng.random() < 0.3)})
                for r in dataset.deployments
            ]
        }
    )
    reg = ModelRegistry(LocalStore(tmp_path), b"k")
    result = pipeline.run("deploy-risk", noisy, reg, seed=1)
    assert result["passed"] is False
    assert result["promoted"] is False
    assert any("auc" in r for r in result["reasons"])  # type: ignore[union-attr]
    assert reg.load_promoted("deploy-risk", pipeline.COLUMNS["deploy-risk"]) is None


def test_gate_refuses_too_little_data(tmp_path) -> None:  # type: ignore[no-untyped-def]
    from devhq_models.registry.registry import ModelRegistry
    from devhq_models.registry.store import LocalStore

    small = generate(1, n_tasks=60, n_deployments=60, n_signins=60)
    reg = ModelRegistry(LocalStore(tmp_path), b"k")
    result = pipeline.run("overdue", small, reg, seed=1)
    assert result["promoted"] is False
    assert any("training rows" in r for r in result["reasons"])  # type: ignore[union-attr]


def _signin(**kw: object) -> SigninFeatures:
    base: dict[str, object] = {
        "org": "default",
        "hour_utc": 11,
        "weekday": 2,
        "distance_km_from_usual": 8,
        "network": "office",
        "new_device": False,
        "velocity_kmh": 1,
        "new_country": False,
    }
    base.update(kw)
    return SigninFeatures(**base)  # type: ignore[arg-type]


def test_signin_anomaly_scores_and_explains(dataset: Dataset) -> None:
    model = SigninAnomalyModel(seed=2).fit(list(dataset.signins))
    normal = model.score(_signin())
    odd = model.score(
        _signin(
            hour_utc=23,
            network="tor",
            distance_km_from_usual=9000,
            velocity_kmh=4500,
            new_device=True,
            new_country=True,
        )
    )
    assert normal.score < 40
    assert odd.score >= 70
    assert "Tor exit node" in odd.reasons  # same words as lib/geo.ts assessRisk
    assert any("Impossible travel" in r for r in odd.reasons)
    assert any("km from usual" in r for r in odd.reasons)
    # Per-org: the 'acme' org has enough rows for its own forest; unknown orgs use the global one.
    assert model.score(_signin(org="acme")).org_model == "acme"
    assert model.score(_signin(org="newco")).org_model == "__global__"


def test_dataset_rejects_identity_fields() -> None:
    with pytest.raises(ValueError):
        Dataset.model_validate(
            {
                "source": "backend",
                "generatedAt": datetime.now(UTC).isoformat(),
                "signins": [
                    {
                        "asOf": datetime.now(UTC).isoformat(),
                        "hourUtc": 1,
                        "weekday": 1,
                        "distanceKmFromUsual": 1,
                        "network": "office",
                        "newDevice": False,
                        "velocityKmh": 1,
                        "newCountry": False,
                        "ip": "203.0.113.9",
                    }
                ],
            }
        )
