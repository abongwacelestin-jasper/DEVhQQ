"""Remaining-time (ETA) model: three quantile gradient-boosting regressors.

Predicts the 10th, 50th and 90th percentile of calendar days until the task
is done, so the UI can show "about 4 days (2-9)". Quantile crossing is fixed
by sorting the three predictions per row.
"""

from __future__ import annotations

import numpy as np
from sklearn.ensemble import GradientBoostingRegressor

from ..features.vectorize import Matrix

QUANTILES = (0.1, 0.5, 0.9)


class QuantileEtaModel:
    def __init__(self, columns: list[str], seed: int) -> None:
        self.columns = list(columns)
        self.seed = seed
        self._models: list[GradientBoostingRegressor] = []

    def fit(self, x: Matrix, y: np.ndarray) -> QuantileEtaModel:
        if x.shape[1] != len(self.columns):
            raise ValueError("feature width does not match the column schema")
        self._models = []
        for q in QUANTILES:
            m = GradientBoostingRegressor(
                loss="quantile",
                alpha=q,
                n_estimators=200,
                max_depth=3,
                learning_rate=0.05,
                subsample=0.8,
                min_samples_leaf=15,
                random_state=self.seed,
            )
            m.fit(x, y)
            self._models.append(m)
        return self

    def predict_quantiles(self, x: Matrix) -> np.ndarray:
        """Shape (n, 3): p10, p50, p90 in days, non-negative and non-crossing."""
        if not self._models:
            raise RuntimeError("model is not fitted")
        preds = np.column_stack([m.predict(x) for m in self._models])
        return np.sort(np.clip(preds, 0.0, None), axis=1)
