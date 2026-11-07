# Pagination

Lists come in three shapes. New modules use the first.

## `{items, nextCursor?}`

Engineering, collaboration, files, tokens and backup lists return

```json
{"items":[…],"nextCursor":"1"}
```

No `nextCursor` means the end. Treat the cursor as opaque. How to pass it
back:

| Lists | Parameter |
|---|---|
| repositories, pull requests, CI runs, monitors, integrations, code findings (`Backend/domain/engineering/store.ts`; `limit` 1–200, default 100) | `?cursor=<nextCursor>` |
| notifications | `?before=<nextCursor>` |
| channel messages (`GET /api/channels/:id/messages`, pages backwards from the newest) | `?before=<nextCursor>` |

```console
$ curl -s -b owner 'http://localhost:8080/api/repos?limit=1'
{"items":[{"id":"demo-blog-platform","name":"blog/platform","product":"blog",…}],"nextCursor":"1"}
```

## Tasks: offset pagination

`GET /api/tasks` accepts `limit` (1–200, default 50) and `offset` (default 0),
sorts by due date, and returns an envelope plus an `X-Total-Count` header:

```console
$ curl -s -b pm 'http://localhost:8080/api/tasks?limit=2&offset=0&status=review,in-progress'
{"total":4,"limit":2,"offset":0,"items":[{"key":"RB-231",…},{"key":"RB-221",…}]}
```

Filters: `product`, `projectId`, `status` and `priority` (comma-separated
lists), `assignee` (`me` for yourself), `q` (substring of key, title and
description, first 100 characters). `total` counts the filtered rows before
paging.

## Plain arrays

The older core routes return every visible row as a plain array:
`GET /api/projects`, `/api/docs`, `/api/team`, `/api/deployments`,
`/api/incidents`, `/api/access/grants`; `/api/tasks/_activity` returns an
object of arrays. A few take a `limit` cap instead of pages:

| Route | Parameter | Default | Max | Order |
|---|---|---|---|---|
| `GET /api/audit` | `limit` | 200 | 500 | newest first |
| `GET /api/_logs` | `limit` | 200 | 500 | newest first |
| `GET /api/locations/sign-ins` | `limit` | 100 | 500 | newest first |
| `GET /api/backups/snapshots` | `limit` | — | 100 | newest first |
| `POST /api/_query` | `limit`, `offset` in the body | — | 500 / 100,000 | `orderBy` |

Check the [reference](reference.md) summary of each route for its parameters.
