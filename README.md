# DocuTeach

A local, private editor for an English grammar teacher. One Markdown document is the single source of truth; answers live only in the document. Nothing leaves the PC; the LLM runs on a local endpoint (llama-swap).

## Status

Frontend, FastAPI backend (lesson library, checkpoints, student PDF and teacher DOCX export, streamed local LLM drafts, AI page edits shown as suggestions to accept or reject, skill files, custom local models) and a Windows desktop launcher. Plain `pnpm dev` without the backend uses a mock in the browser (localStorage).

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

Backend, from `backend/` (Python 3.12): `pip install -r requirements.txt`, then `pytest`, `ruff check`, `pyright`. Tests that need the real model are marked `llm` and skipped by default.

The dev server binds to `127.0.0.1` (default port 5173).

## Repository layout

```
backend/    Python, FastAPI (lessons, export, LLM client)
frontend/   React 19 + TipTap 3 + Vite
desktop/    Windows launcher and PyInstaller build (`desktop/build.py`)
docs/       Documentation — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
```

Repository: https://github.com/bakumetsu/DocuTeach
