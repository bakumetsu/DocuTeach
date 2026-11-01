# Skills

Referenced from `CLAUDE.md`. Skills load only when chosen, so load them at the trigger; every rule that must always apply stays in `CLAUDE.md`. Each skill's trigger is also in its description, which every chat sees.

The skills are shared with EcholonBot: `kit\skills` is a junction into the shared kit (`E:\Github Project\shared-kit`), loaded through `.claude\skills`. Each skill starts with the generic rules and tells you to read `kit\skills-project\<skill>.md` too, which holds the DocuTeach rules.

- `orca-ticket-ops`: before opening, setting up, launching, progress-checking, finishing or deleting a ticket workspace, or writing a task text.
- `design-workflow`: before starting, writing, reviewing or closing a design ticket.
- `commit-and-push`: before any commit, squash or push, a diff review, or a test or type failure fix: it holds the checklist, the message and co-author format, and the docs pass before every push.
- `build-and-log`: before a trial build (`ticket_build.py`), running test suites, the dev server, LLM tests, reading app logs, or adding a log line.
- `session-handoff`: when the planner session is long or ending, on "cleanwipe", or before a new chat; rewrites the short handoff file and keeps memory clean.
- `impeccable` (opt-in via `[setup] skills_extra`, DocuTeach and Stash-Downloader only): before designing, redesigning, critiquing, auditing or polishing a frontend screen; its offline detector runs in `dt_checks.py` (warn mode).
