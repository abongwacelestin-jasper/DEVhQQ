"""Turns model drivers (column names) into short sentences for the UI."""

from __future__ import annotations

from ..features.schema import DeployFeatures, TaskFeatures
from ..features.vectorize import provider_bucket
from .classifier import Driver


def _plural(n: float, word: str) -> str:
    v = round(n)
    return f"{v} {word}{'' if v == 1 else 's'}"


def describe_task(d: Driver, f: TaskFeatures) -> str | None:
    c = d.column
    if c == "blocked":
        return "Blocked by another open task"
    if c == "days_to_due":
        if f.days_to_due < 0:
            return f"Already {_plural(-f.days_to_due, 'day')} past due"
        return f"Due in {_plural(f.days_to_due, 'day')}"
    if c == "estimate":
        return f"Large estimate ({f.estimate:g} h)"
    if c == "status_age_days":
        return f"No status change for {_plural(f.status_age_days, 'day')}"
    if c == "age_days":
        return f"Open for {_plural(f.age_days, 'day')}"
    if c == "assignee_open_tasks":
        return f"Assignee has {_plural(f.assignee_open_tasks, 'open task')}"
    if c == "assignee_late_rate":
        return f"Assignee finished {round(f.assignee_late_rate * 100)}% of recent tasks late"
    if c == "assignee_throughput_30d":
        return f"Assignee closed {_plural(f.assignee_throughput_30d, 'task')} in 30 days"
    if c in ("subtask_completion", "subtasks_total"):
        return f"{f.subtasks_done} of {_plural(f.subtasks_total, 'subtask')} done"
    if c in ("logged_hours", "logged_vs_estimate"):
        return f"{f.logged_hours:g} h logged against a {f.estimate:g} h estimate"
    if c == "comments":
        return f"{_plural(f.comments, 'comment')} of discussion"
    if c.startswith("status="):
        return f"Still in {f.status}"
    if c.startswith("priority="):
        return f"{f.priority.capitalize()} priority"
    if c.startswith("type="):
        return f"{f.type.capitalize()} work"
    return None


def describe_deploy(d: Driver, f: DeployFeatures) -> str | None:
    c = d.column
    if c == "production":
        return "Production environment"
    if c in ("hour_sin", "hour_cos", "off_hours"):
        return f"Off-hours change ({f.hour_utc:02d}:00 UTC)"
    if c in ("weekday", "weekend"):
        return "Weekend change" if f.weekday >= 5 else None
    if c == "requester_failure_rate":
        return f"Requester's recent deploys failed {round(f.requester_failure_rate * 100)}%"
    if c == "requester_deploys_90d":
        return f"Requester has {_plural(f.requester_deploys_90d, 'deploy')} in 90 days"
    if c == "product_failure_rate_30d":
        return (
            f"Product's deploy failure rate is {round(f.product_failure_rate_30d * 100)}% (30 days)"
        )
    if c == "product_incidents_7d":
        return f"{_plural(f.product_incidents_7d, 'incident')} on this product in 7 days"
    if c == "open_incidents":
        return f"{_plural(f.open_incidents, 'open incident')} on this product"
    if c == "log_hours_since_last_deploy":
        return f"{_plural(f.hours_since_last_deploy, 'hour')} since the last deploy"
    if c.startswith("provider="):
        return f"Provider: {provider_bucket(f.provider)}"
    return None


def phrases(texts: list[str | None]) -> list[str]:
    seen: list[str] = []
    for t in texts:
        if t and t not in seen:
            seen.append(t)
    return seen
