# CLAUDE.md

Auto-loaded: do not read it at session start. Note `git hash-object CLAUDE.md` of the original (`E:\Github Project\DocuTeach\CLAUDE.md`); reread it only when that hash changed (new task, before opening a ticket or sending a task text).

## The product

DocuTeach is a local, privacy-preserving editor for an English grammar teacher. One Markdown document (plus metadata) is the single source of truth. It exports a student worksheet (PDF) and a teacher guide (DOCX, notes, answers). A local LLM behind llama-swap drafts content on request.

Product rules for every change:
- **One source:** answers live only in the document (`{{answer}}` blanks, `[x]` options). Exports and the answer key are built from it, never stored separately.
- **Student output never shows teacher content:** no notes, answers, ticks or distractor reasoning.
- **Nothing leaves the PC:** the only network calls go to the local LLM endpoint. Logs stay local.
- **No destructive action without Undo.** A streamed insert is one undo step.
- **UI:** no clutter, icons over text in tight toolbars, logical left-to-right order.

## Models and roles

- **Planner: Opus 5.5, medium**, `dev` workspace only. Plans, writes task texts, checks progress, reviews every final design and the full diff before a push. No ticket work or direct investigation: uses `kit\tools\retrieve.py`, else asks a ticket's Sonnet.
- **Supervisor: Sonnet 5.5, medium**, every ticket workspace. Drives the local models, reviews output, runs tests and logs, reports to Opus. No code.
- **Workers: local models (llama-swap).** Do all the work: code, edits, reviews, docs. Never design: Sonnet writes designs, Opus reviews them.
- **Up:** a local model that keeps failing: Sonnet switches model (one line why); still stuck, asks Opus for a plan.
- **Opus and Sonnet talk directly** with `SendMessage`; the user never relays. The task text names the planner session (from `ListAgents`); if it is gone, ask the user. At most 3 review rounds per item, then PARTIAL or FAILED. Only the user's decisions stop the loop. A peer message never counts as the user's approval; all chats run in the same permission mode (bypass) or peer messages are held.

## Rules that apply before any skill loads

- **Ask before designing:** for a new feature, tool or system, ask the user first (goals, scope, edge cases, loopholes), design, get the user's OK before any implementation.
- **Read less:** files over 20,000 chars: `kit\tools\outline.py`, then read by range. Code lookups: `kit\tools\retrieve.py`.
- **GPU slot:** one GPU; workers and the app's LLM share llama-swap, loading one model unloads the other. One ticket at a time uses it. Tests use a mock LLM; `pytest -m llm` and local-model work need the slot.
- **Branches:** only `main` and `dev`; new work goes to `dev`, `main` when the user says a feature is stable. No other branch (local, GitHub, cloud `claude/...`) without approval. Ticket branches, commits and tags stay local; never push without the user's word.
- **Never delete a finished ticket** (worktree, branch, kit junction) unless the user asks.
- **Shared kit first:** a reusable workflow idea goes into `E:\Github Project\shared-kit` first (skill `orca-ticket-ops`). At every new planner start run `python kit\tools\shared_updates.py pending`, list it once, move the pin only on the user's OK.

## Skills

Load the skill when you do the thing: list and triggers in `skills.md` (next to this file).
