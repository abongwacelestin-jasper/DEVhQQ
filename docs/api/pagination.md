# Pagination

Today one list pages properly; the others return everything the caller may
see, some with a `limit` cap.

## Tasks: offset pagination

`GET /api/tasks` accepts `limit` (1–200, default 50) and `offset` (default 0),
sorts by due date, and returns an envelope plus an `X-Total-Count` header:

```console
$ curl -s -D - -o /dev/null -b pm 'http://localhost:8080/api/tasks?limit=2&offset=0&status=review,in-progress' | grep X-Total-Count
X-Total-Count: 4
$ curl -s -b pm 'http://localhost:8080/api/tasks?limit=2&offset=0&status=review,in-progress'
{"total":4,"limit":2,"offset":0,"items":[{"key":"RB-231",…},{"key":"RB-221",…}]}
```

Filters: `product`, `projectId`, `status` and `priority` (comma-separated
lists), `assignee` (`me` for yourself), `q` (substring of key, title and
description, first 100 characters). `total` counts the filtered rows before
paging.

## Lists with a cap

| Route | Parameter | Default | Max | Order |
|---|---|---|---|---|
| `GET /api/audit` | `limit` | 200 | 500 | newest first |
| `GET /api/_logs` | `limit` | 200 | 500 | newest first |
| `GET /api/locations/sign-ins` | `limit` | 100 | 500 | newest first |
| `POST /api/_query` | `limit`, `offset` in the body | — | 500 / 100,000 | `orderBy` |

The query runner returns `{from, total, returned, offset, limit, ms, rows}`.

## Lists without paging

`GET /api/projects`, `/api/docs`, `/api/team`, `/api/deployments`,
`/api/incidents`, `/api/access/grants`, `/api/tasks/_activity` return plain
arrays (or, for `_activity`, an object of arrays) of every visible row. They
are small in this organisation.

> [!NOTE]
> **Planned: Wave 4.** New list endpoints return `{items: […], nextCursor?}`
> (`docs/agents/WAVE4.md` §6): pass `nextCursor` back to get the next page;
> its absence means the end. Message history uses `?before=` on
> `GET /api/channels/:id/messages`. Existing lists keep their current shape
> unless their lane changes them; this page will be updated as they merge.
