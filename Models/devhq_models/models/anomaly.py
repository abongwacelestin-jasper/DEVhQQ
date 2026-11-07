"""Per-organisation sign-in anomaly detection (IsolationForest).

Each organisation with enough history gets its own forest (what is "normal"
differs: a fully remote team signs in from everywhere). Smaller orgs use the
global forest. The raw anomaly score is mapped to 0-100 against the org's own
training distribution, so the backend's ``riskDecision`` thresholds (40 =
challenge, 70 = block) keep their meaning.

Reasons are written in the same human words as ``Backend/lib/geo.ts``
``assessRisk`` and are derived from how this sign-in differs from the org's
baseline (robust z-scores and category frequencies), not from model internals.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

import numpy as np
from sklearn.ensemble import IsolationForest

from ..features.schema import NETWORKS, SigninFeatures
from ..features.vectorize import SIGNIN_COLUMNS, Matrix, matrix, signin_vector

GLOBAL = "__global__"
MIN_ORG_ROWS = 200
IMPOSSIBLE_KMH = 900.0
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


@dataclass
class OrgBaseline:
    rows: int
    distance_median: float
    distance_mad: float
    velocity_median: float
    velocity_mad: float
    hour_freq: list[float]
    weekday_freq: list[float]
    network_freq: dict[str, float]
    new_device_rate: float
    raw_q50: float
    raw_q99: float


@dataclass
class OrgModel:
    forest: IsolationForest
    baseline: OrgBaseline


@dataclass(frozen=True)
class AnomalyResult:
    score: int
    reasons: list[str]
    raw: float
    org_model: str


def _mad(values: np.ndarray) -> float:
    med = float(np.median(values))
    return float(np.median(np.abs(values - med))) * 1.4826 or 1.0


def _baseline(rows: list[SigninFeatures], raw: np.ndarray) -> OrgBaseline:
    dist = np.array([r.distance_km_from_usual for r in rows])
    vel = np.array([r.velocity_kmh for r in rows])
    hours = Counter(r.hour_utc for r in rows)
    days = Counter(r.weekday for r in rows)
    nets = Counter(r.network for r in rows)
    n = len(rows)
    return OrgBaseline(
        rows=n,
        distance_median=float(np.median(dist)),
        distance_mad=_mad(dist),
        velocity_median=float(np.median(vel)),
        velocity_mad=_mad(vel),
        # Smooth each hour with its neighbours so 09:00 vs 10:00 is not "rare".
        hour_freq=[
            (hours[(h - 1) % 24] + hours[h] + hours[(h + 1) % 24]) / (3 * n) for h in range(24)
        ],
        weekday_freq=[days[d] / n for d in range(7)],
        network_freq={k: nets[k] / n for k in NETWORKS},
        new_device_rate=sum(r.new_device for r in rows) / n,
        raw_q50=float(np.quantile(raw, 0.5)),
        raw_q99=float(np.quantile(raw, 0.99)),
    )


class SigninAnomalyModel:
    columns = SIGNIN_COLUMNS

    def __init__(self, seed: int, n_estimators: int = 200) -> None:
        self.seed = seed
        self.n_estimators = n_estimators
        self.orgs: dict[str, OrgModel] = {}

    def _fit_one(self, rows: list[SigninFeatures]) -> OrgModel:
        x = matrix([signin_vector(r) for r in rows], len(self.columns))
        forest = IsolationForest(
            n_estimators=self.n_estimators, contamination="auto", random_state=self.seed
        )
        forest.fit(x)
        raw = -forest.score_samples(x)
        return OrgModel(forest=forest, baseline=_baseline(rows, raw))

    def fit(self, rows: list[SigninFeatures]) -> SigninAnomalyModel:
        if len(rows) < 50:
            raise ValueError("need at least 50 sign-ins to fit an anomaly model")
        self.orgs = {GLOBAL: self._fit_one(rows)}
        by_org: dict[str, list[SigninFeatures]] = {}
        for r in rows:
            by_org.setdefault(r.org, []).append(r)
        for org, org_rows in by_org.items():
            if len(org_rows) >= MIN_ORG_ROWS:
                self.orgs[org] = self._fit_one(org_rows)
        return self

    def _model_for(self, org: str) -> tuple[str, OrgModel]:
        if org in self.orgs:
            return org, self.orgs[org]
        return GLOBAL, self.orgs[GLOBAL]

    def raw_scores(self, rows: list[SigninFeatures]) -> np.ndarray:
        """Higher = more anomalous. Each row is scored by its own org's forest."""
        out = np.zeros(len(rows))
        groups: dict[str, list[int]] = {}
        for i, r in enumerate(rows):
            groups.setdefault(self._model_for(r.org)[0], []).append(i)
        for name, idx in groups.items():
            x = matrix([signin_vector(rows[i]) for i in idx], len(self.columns))
            out[idx] = -self.orgs[name].forest.score_samples(x)
        return out

    def score(self, f: SigninFeatures) -> AnomalyResult:
        if not self.orgs:
            raise RuntimeError("model is not fitted")
        name, m = self._model_for(f.org)
        x: Matrix = matrix([signin_vector(f)], len(self.columns))
        raw = float(-m.forest.score_samples(x)[0])
        b = m.baseline
        spread = max(b.raw_q99 - b.raw_q50, 1e-6)
        # q50 -> 0, q99 -> ~67 (challenge band), far outliers saturate at 100.
        scaled = (raw - b.raw_q50) / spread / 1.5
        score = round(100 * min(max(scaled, 0.0), 1.0))
        reasons = describe(f, b)
        if score >= 40 and not reasons:
            reasons = ["Unusual combination of sign-in signals for this organisation"]
        return AnomalyResult(score=score, reasons=reasons, raw=raw, org_model=name)


@dataclass(order=True)
class _Reason:
    weight: float
    text: str = field(compare=False)


def describe(f: SigninFeatures, b: OrgBaseline) -> list[str]:
    """Human-readable reasons, strongest first (max 4)."""
    out: list[_Reason] = []
    if f.network == "tor":
        out.append(_Reason(100, "Tor exit node"))
    elif f.network == "vpn":
        out.append(_Reason(60, "Anonymising VPN"))
    elif f.network == "datacenter":
        out.append(_Reason(65, "Datacenter IP — likely automation"))

    if f.velocity_kmh > IMPOSSIBLE_KMH and f.distance_km_from_usual > 500:
        out.append(_Reason(95, f"Impossible travel: about {round(f.velocity_kmh):,} km/h"))
    elif (f.velocity_kmh - b.velocity_median) / b.velocity_mad > 4 and f.velocity_kmh > 300:
        out.append(
            _Reason(55, f"Unusually fast travel between sign-ins ({round(f.velocity_kmh):,} km/h)")
        )

    dist_z = (f.distance_km_from_usual - b.distance_median) / b.distance_mad
    if dist_z > 3 and f.distance_km_from_usual > 300:
        out.append(
            _Reason(70, f"{round(f.distance_km_from_usual):,} km from usual sign-in locations")
        )
    if f.new_country:
        out.append(_Reason(50, "First sign-in from this country"))
    if f.new_device and b.new_device_rate < 0.3:
        out.append(_Reason(40, "New device or network for this member"))
    if b.hour_freq[f.hour_utc] < 0.01:
        out.append(_Reason(35, f"Unusual time of day ({f.hour_utc:02d}:00 UTC)"))
    if b.weekday_freq[f.weekday] < 0.02:
        out.append(_Reason(25, f"Unusual day for this organisation ({WEEKDAYS[f.weekday]})"))
    return [r.text for r in sorted(out, reverse=True)[:4]]
