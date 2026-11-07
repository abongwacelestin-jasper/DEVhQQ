"""Calibrated gradient-boosted classifier with local, model-agnostic drivers.

Used for task overdue risk and deployment risk. Gradient boosting gives the
ranking; isotonic (large data) or sigmoid (small data) calibration on held-out
folds makes the probability mean what it says, which matters because the UI
shows it as a percentage.

Drivers: for one prediction, each feature is reset to the training median and
the change in probability is measured. Features whose real value pushes the
risk up the most are returned. It is a local sensitivity estimate, not a
causal claim, and the model card says so.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import HistGradientBoostingClassifier

from ..features.vectorize import Matrix

ISOTONIC_MIN_ROWS = 1000


@dataclass(frozen=True)
class Driver:
    column: str
    delta: float


class CalibratedBoostedClassifier:
    def __init__(self, columns: list[str], seed: int) -> None:
        self.columns = list(columns)
        self.seed = seed
        self._model: CalibratedClassifierCV | None = None
        self._reference: Matrix | None = None

    def fit(self, x: Matrix, y: np.ndarray) -> CalibratedBoostedClassifier:
        if x.shape[1] != len(self.columns):
            raise ValueError("feature width does not match the column schema")
        base = HistGradientBoostingClassifier(
            max_iter=250,
            learning_rate=0.06,
            max_leaf_nodes=15,
            min_samples_leaf=20,
            l2_regularization=1.0,
            random_state=self.seed,
        )
        method = "isotonic" if len(x) >= ISOTONIC_MIN_ROWS else "sigmoid"
        self._model = CalibratedClassifierCV(estimator=base, method=method, cv=3)
        self._model.fit(x, y.astype(int))
        self._reference = np.median(x, axis=0)
        return self

    def predict_proba(self, x: Matrix) -> np.ndarray:
        if self._model is None:
            raise RuntimeError("model is not fitted")
        proba: np.ndarray = self._model.predict_proba(x)[:, 1]
        return proba

    def drivers(self, row: Matrix, top: int = 3, min_delta: float = 0.02) -> list[Driver]:
        if self._reference is None:
            raise RuntimeError("model is not fitted")
        base = float(self.predict_proba(row.reshape(1, -1))[0])
        probes = np.repeat(row.reshape(1, -1), len(self.columns), axis=0)
        for j in range(len(self.columns)):
            probes[j, j] = self._reference[j]
        deltas = base - self.predict_proba(probes)
        ranked = sorted(
            (Driver(self.columns[j], float(d)) for j, d in enumerate(deltas) if d >= min_delta),
            key=lambda d: d.delta,
            reverse=True,
        )
        return ranked[:top]
