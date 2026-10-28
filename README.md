# DocuTeach

A local, private editor for an English grammar teacher. One Markdown document is the single source of truth; answers live only in the document. Nothing leaves the PC; the planned LLM runs on a local endpoint.

## Status

Frontend with a mock backend in the browser (localStorage). No `backend/`, no export, no real LLM yet.

## Prerequisites

- Node.js
- pnpm

## Getting started

Run from `frontend/`:

```
pnpm install      # install dependencies
pnpm dev          # dev server
pnpm test         # run tests (vitest)
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
pnpm build        # typecheck, then vite build
```

The dev server binds to `127.0.0.1` (default port 5173).

## Repository layout

```
backend/    Planned (Python, FastAPI)
frontend/   React 19 + TipTap 3 + Vite
docs/       Documentation — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
```

Repository: https://github.com/bakumetsu/DocuTeach
