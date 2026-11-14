# Concepts

How TavetaHQ decides who can see and do what, and how it keeps a record of it.
Read them in this order; each builds on the previous.

1. [Products, projects and scope](products-and-scope.md) — what data exists and
   how it is partitioned.
2. [Roles and permissions](roles-and-permissions.md) — six roles, seven areas,
   five levels; and the generated [permission matrix](permission-matrix.md).
3. [Sessions and continuous verification](sessions.md) — sign-in, the second
   factor, and the checks repeated on every request.
4. [Step-up verification](step-up.md) — re-verifying before sensitive actions.
5. [JIT elevation](jit-access.md) — time-boxed production access with a second
   approver.
6. [Audit log](audit-log.md) — the hash-chained record of every change.
7. [Location risk](location-risk.md) — scoring sign-ins by where they come from.

Terms are defined in the [glossary](../glossary.md).
