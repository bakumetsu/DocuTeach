# CLAUDE.md

## Reread this file

Read this file in full with the Read tool at session start, when a new task starts in the same thread, and before creating a ticket workspace or sending a ticket its task text. In a ticket chat the setup copy in the worktree root loads automatically; that counts as the read. The reread applies to the Opus planner, and to a ticket only if this file changed during the ticket (original: `E:\DocuTeach\DocuTeach\CLAUDE.md`).

## The product

DocuTeach is a local, privacy-preserving editor for an English grammar teacher. One Markdown document (plus metadata) is the single source of truth. It exports a student worksheet (PDF, no answers, no teacher notes) and a teacher guide (DOCX, notes, inline answers, answer key). A local LLM behind llama-swap drafts content on request. The design lives in `kit\designs\`.

Product rules that apply to every change:
- **One source:** answers live only in the document (`{{answer}}` blanks, `[x]` options). Exports and the answer key are built from it, never stored separately.
- **Student output never shows teacher content:** no notes, answers, ticks or distractor reasoning.
- **Nothing leaves the PC:** the only network calls go to the local LLM endpoint. Logs stay local.
- **No destructive action without Undo.** A streamed insert is one undo step.
- **UI:** no clutter, icons over text in tight toolbars, logical left-to-right order.

## Models and roles

- **Planner and progress checker: Opus 5.5, medium.** Runs in the `dev` workspace only. Plans, splits work into tickets, writes task texts, checks progress, reviews every final design and the full diff before a push. Does no ticket work and no direct investigation (log greps, library source, config hunts): it asks a ticket's Sonnet or opens a small ticket, then reviews the result.
- **Supervisor: Sonnet 5.5, medium.** Runs every ticket workspace. Drives the local models, reviews their output, runs tests, the dev server and log reads, reports to Opus. Does not write code itself.
- **Workers: local models (llama-swap).** Do all the work: code, edits, reviews, docs, chores. Never design: Sonnet writes designs, Opus reviews them.

Up: if a local model keeps failing a step, Sonnet switches the model and says in one line what changed and why (Sonnet stays at medium). If still too hard, Sonnet asks Opus 5.5 (medium, in `dev`) for a plan or solution, then local models carry it out. Down: none needed.

## Ask before designing

For a new feature, tool or system, first ask the user about goals, scope, preferred approach, edge cases, and bugs or loopholes the idea may miss. Then write the design and get the user's OK before any implementation or hand-off.

## Code review (tiered)

- **Docs-only or tests-only commit:** a local model reviews it. No Sonnet review.
- **Code commit (`backend/`, `frontend/`, kit tools, config):** a local model reviews the diff first. Sonnet then reviews only the validator output (backend: `ruff`, `pyright`, `pytest`; frontend: `tsc`, `eslint`, `vitest`) and this checklist: the product rules above; custom blocks (teacher note, blank, multiple choice, split point) survive the Markdown round trip unchanged (golden tests); LLM output is validated against its schema before it reaches the editor, and invalid output falls back to plain text; async endpoints never block, and an aborted client cancels the upstream LLM request; one KV slot per chat; config defaults set in code; no traps from `kit\bible\TRAPS.md`. Fix or answer every finding before committing.
- **Before a push:** Opus reviews the full diff being pushed, once. Fix or answer every finding first.
- **Test or type failures:** the local model gets at most 2 fix attempts before Sonnet is asked. Reject a fix that deletes or skips a test, weakens an assertion, or removes more lines than it adds.

## GPU slot

The PC has one GPU (16 GB). The local workers and the app's own LLM features share llama-swap, and loading one model unloads the other. So **only one ticket at a time uses llama-swap**, for coding or for LLM testing. Tests run against a mock LLM server by default; tests that need a real model (`pytest -m llm`) need the GPU slot. Design tickets (Sonnet only) and tests without an LLM never need it.

## "Go midnight": shut down the PC when done

"Go midnight" in this thread approves shutting down the PC once the **last task** is done: the last task in the user's queue, or, with no queue, the task running now. Start nothing beyond that. Then save everything, stop background tools (llama-swap, dev servers), post a wrap-up (done, left, `shutdown /a` cancels), and run `shutdown /s /t 60`.

## Backup files

Backup or draft copies of kit files (`*.bak-*`, `*.proposed`, etc.) go into `kit\temps backup\`, mirroring the original folder structure. Never next to the original.

## Git branches

Repo: github.com/bakumetsu/DocuTeach, local folder `E:\DocuTeach\DocuTeach`. Backend in `backend/` (Python, FastAPI), frontend in `frontend/` (TipTap), docs in `docs/`, kit in `kit\` (gitignored, local only). New work goes to `dev`; promote to `main` only when the user says a feature is stable.

Only `main` and `dev` exist. Never create another branch, local or on GitHub (including a cloud session's `claude/...` branch), without the user's approval. When an approved extra branch is done, tag its last commit `archive/<branch name>`, push the tag, and delete the branch.

## Orca workspaces (ticket system)

Each ticket (`fix-`, `feat-` or `design-<name>`) is an Orca workspace: a child of `dev`, on its own branch cut from `dev`. Ticket workspaces, branches, commits and tags stay **local**: never `git push` (code or tags) unless the user says so. This overrides the push and tag-push rules above for ticket work.

- Open tickets: at most **one coding ticket and three design tickets**. A design ticket closes when its design is approved and the work moves to implementation, which then opens as the coding ticket. A kit-only ticket may run alongside the coding ticket with the user's OK; it still follows the GPU slot rule.
- Design tickets: Sonnet writes the design itself (no local models) in `kit\designs\<name>.md`. **Never commit or push a design document.** Opus 5.5 (medium) must review it before it goes to the user; the ticket closes only after that review and the user's OK, and is then just flagged `completed`.
- Finishing: when all pass bars pass, the ticket may run `python kit\tools\ticket_build.py <ticket> --keep` from the main folder (merges into local `dev` after the test suite passes) and flag itself `completed` with `orca worktree set --worktree "id:<repo-id>::<ticket path>" --workspace-status completed`, without asking. A bar with zero samples is "not exercised", not a pass. Pushing still needs the user's word. Otherwise finish only when the user says so.
- Never delete a finished ticket (worktree, branch and kit junction stay) unless the user asks. `completed` tickets do not count toward the open-ticket limits.

### Ticket reports

Every final ticket report, every progress report Opus passes on, and every wrap-up starts with a **state line**, then a plain-English summary, then the technical details:

1. **State line:** `<name> (T-XX): <STATE>: <who acts next>` (`<name>` = the ticket name, `T-XX` / `D-XX` = its backlog ID from `kit\designs\backlog.md`), using exactly one of these states (and set the matching Orca status):

   | State line (`<name> (T-XX): ...`) | Meaning | Orca status |
   |---|---|---|
   | `<name> (T-XX): PASSED: merged locally, ready to push` | All bars met, merged into local `dev`; goes out with the next push after the Opus diff review | `completed` |
   | `<name> (T-XX): PARTIAL: needs your review` | Some bars met; the fix helps but does not solve it; not merged | `in-review` |
   | `<name> (T-XX): FAILED: needs your review` | Bars not met, or the fix made things worse; not merged | `in-review` |
   | `<name> (T-XX): BLOCKED: needs your answer` | Cannot continue without information from the user | `todo` |
   | `<name> (T-XX): DESIGN READY: needs your approval` | Design passed the Opus review and waits for the user's OK | `in-review` |
   | `<name> (T-XX): RUNNING: <what it is doing now>` | Progress check only | `in-progress` |

2. **TL;DR (3 to 4 sentences, everyday language):** the core problem, the fix made, the test outcome (passed, partial or failed, with one headline number), and the exact decision or action needed from the user ("No decision needed" when none). No code names, endpoint paths, node names or variable names.
3. **Why it isn't merged** (only PARTIAL, FAILED, BLOCKED): everyday language, no jargon.
4. **`### Engineering Details`:** everything else below this divider: commits, test counts per suite, golden-file results, export checks, model and timings for LLM tests, what was not measured.

## Commit messages (Conventional Commits)

Follow https://gist.github.com/qoomon/5dfcdf8eec66a051ecd85625518cfd13 for every commit and squash.

- Format: `<type>(<optional scope>): <description>`, blank line, optional body, optional footer.
- Types: `feat`, `fix`, `refactor`, `perf`, `style`, `test`, `docs`, `build`, `ops`, `chore`.
- Subject: imperative, lowercase start, no trailing period. Scope optional, never an issue number: `editor`, `export`, `skills`, `api`, `llm`, `ui`, `kit`, `docs`. Body: why, and how it differs from before. Footer `Refs: T-XX` for ticket work.
- Breaking changes: `!` before the colon plus a `BREAKING CHANGE:` footer. Merge and revert commits keep Git's default messages.
- Local model co-authors: when local models wrote or reviewed committed work, add one `Co-Authored-By` line per model, in the order used, with the full capitalized name (provider or quant, base model and size from the llama-swap config or GGUF name, then `(local model)`), e.g. `Co-Authored-By: Byteshape Qwen3.8-27B (local model) <noreply@localhost>`. They go just before the Claude `Co-Authored-By` line, which stays last.
- Examples: `feat(editor): add the multiple-choice block with auto-lettered options`, `fix(export): keep teacher notes out of the student PDF`.

## Docs before every push

Before pushing a commit that changes `backend/`, `frontend/`, a kit tool or a config file:

1. Start a Sonnet 5.5 subagent (medium) with only `git diff <base>...HEAD`, the doc list below and the commit subjects. It reads doc sections with grep, not whole files.
2. It has a local model update what the diff makes stale, and reviews the result: `docs/ARCHITECTURE.md` and `README.md` (code), `kit\README.md` (kit tools, local only), the open handoff or session summary.
3. Review its diff, commit as `docs(<scope>): ...`, push code and docs together.
4. If no doc needs a change, add `Docs: none (<reason>)` to the last commit message.

Once `kit\tools\doc_update.py` is ported and proven on real diffs, it replaces steps 1 and 2: `python kit\tools\doc_update.py <base>`. Until then use the subagent.

This overrides the default of not starting subagents. To be enforced by `.githooks/pre-push` (`git config core.hooksPath .githooks` once per clone) and a `docs check` workflow on PRs into `dev` and `main`, once those are ported from EcholonBot.

## Skills

These load only when chosen, so load them at the trigger; everything that must always apply is above. Until the kit setup ticket ports them into `.claude\skills\`, the EcholonBot copies in `kit\skills\` are reference only.

- `orca-ticket-ops`: before opening, setting up, launching, progress-checking, finishing or deleting a ticket workspace, or writing a task text.
- `design-workflow`: before starting, writing, reviewing or closing a design ticket.
- `test-and-log`: before running test suites, the dev server, LLM tests, reading app logs, or adding a log line; also its log-retention rule.
- `session-handoff`: when the planner session is long or ending, or before a new chat; rewrites the short handoff file and keeps memory clean.
