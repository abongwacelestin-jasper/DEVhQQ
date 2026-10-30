# DevHQ

Monorepo-style project with independent Backend, Frontend, and Models folders.

## Structure

- **Backend/** - Node.js API server (TypeScript, no build step)
- **Frontend/** - React web application (Vite + TypeScript)
- **Models/** - Machine learning models

## Getting Started

### Frontend

```bash
cd Frontend
npm install
npm run dev
```

### Backend

```bash
cd Backend
npm run dev
```

The backend control room is available at `http://localhost:8080/backend.html`
(also `/console`). Sign in to browse the live API inventory, inspect scoped data
and runtime diagnostics, manage deployments and incidents, review sign-ins and
audit history, and operate backup, team, session and just-in-time access controls.
Query results can be exported as CSV. Development demo accounts are shown only
when demo sign-in is enabled. All actions continue to use server-side
authorization and auditing.

### Models

```bash
cd Models
# (setup as needed)
```
