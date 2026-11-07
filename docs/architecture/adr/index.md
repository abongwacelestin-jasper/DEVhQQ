# Architecture decision records

Each record states the context, the decision, and its consequences, and is
grounded in the code or in the Wave 4 owner decisions (`docs/agents/WAVE4.md`).
Records are numbered and never renumbered; a reversed decision gets a new
record that supersedes the old one.

| # | Decision | Status |
|---|---|---|
| [0001](0001-no-framework-backend.md) | No web framework: a route table on `node:http` | Accepted, implemented |
| [0002](0002-strip-only-typescript.md) | Run TypeScript with Node's type stripping, no build step | Accepted, implemented |
| [0003](0003-postgres-jsonb-collections.md) | PostgreSQL through JSONB collections behind the `Collection` seam | Accepted, implemented |
| [0004](0004-s3-compatible-object-storage.md) | S3-compatible object storage (MinIO locally) | Accepted, implemented |
| [0005](0005-separate-python-ml-service.md) | A separate Python ML service behind the backend | Accepted, implemented |
| [0006](0006-cookie-only-browser-sessions.md) | Browser sessions travel only in a `__Host-` cookie | Accepted, implemented |
| [0007](0007-two-person-deploy-rule.md) | Two-person rule for production deploys and JIT access | Accepted, implemented |
| [0008](0008-hash-chained-audit-log.md) | Hash-chained, append-only audit log | Accepted, implemented |

Template for a new record:

```markdown
# NNNN. Title in the imperative

- **Status:** Proposed | Accepted | Superseded by NNNN
- **Date:** YYYY-MM-DD
- **Deciders:** …

## Context
## Decision
## Consequences
## References
```
