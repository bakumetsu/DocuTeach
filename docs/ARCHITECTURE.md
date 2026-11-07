# DocuTeach Architecture

## Overview

DocuTeach is a local, private editor for an English grammar teacher. A single Markdown document is the source of truth; answers live only inside the document (`{{answer}}` blanks, `[x]` options). The frontend is a React 19 single-page application built with Vite, using TipTap 3 (ProseMirror) as the editing engine. A FastAPI backend (`backend/`) stores lessons, exports the student PDF and teacher DOCX, streams drafts and AI page edits from a local llama-swap endpoint, and manages skills and local models. When the page has no backend token (plain `pnpm dev`), the frontend falls back to a mock backend in the browser: docs and checkpoints are kept in `localStorage`, models and skills in memory. A Windows desktop launcher (`desktop/`) bundles both.

Product invariants enforced in code:

- Student output never exposes teacher content.
- Nothing leaves the PC except requests to a local LLM endpoint.
- No destructive action without Undo; a streamed insert is exactly one undo step.

## Source layout

All source lives under `frontend/src/`.

| Folder | Responsibility |
|--------|---------------|
| `main.tsx`, `App.tsx` | Entry point and root component. |
| `api/` | `types.ts` defines `interface DocuTeachApi` (models including custom models, `chat.stream`, chats, skills, lessons, docs with checkpoints, export, fonts). `index.ts` exports `api = hasToken() ? httpApi : mockApi`. `api/http/` is the real client (`client.ts` sends `X-DocuTeach-Token` to `/api`, `stream.ts` reads the chat stream, `export.ts` downloads exports). `api/mock/` implements the mock (chat, config, docs, models, script, skills). Docs and checkpoints are persisted in `localStorage` under keys prefixed `docuteach:v1:doc:` and `docuteach:v1:ckpt:`. |
| `markdown/` | Pure Markdown parse/serialise layer. `parse.ts` (`parseMarkdown`, `parseFragment`), `serialize.ts`, `serialize-inline.ts`, `blocks.ts`, `inline.ts`, `escape.ts`, `frontmatter.ts` (YAML → `Meta`), `md.ts` (`createMd`: markdown-it with `html:false`, `linkify:false`; `createChatMd`: chat variant with tables only, no links or HTML), `rules/` (custom markdown-it rules for blank, comment, div, mark, raw, span, table). |
| `editor/` | TipTap integration. `extensions.ts` (extension list, StarterKit). `nodes/` (Align, Blank, DocMeta, Mcq/McqQuestion/McqOption, RawBlock, SplitPoint, TeacherNote). `nodeviews/` (React views for Blank, Mcq, Raw, Split, TeacherNote). `EditorPane.tsx`, `PreviewPane.tsx`. `project.ts` (`projectStudent`). `ViewContext.ts` (`ViewMode`). `stream.ts` (StreamSlot, `startPageStream`, `cancelPageStream`). `insert.ts` (`validateFragment`, `plainParagraphs`, `insertFragment`). `history.ts` (revert/redo, `setDraftCanceller`). `guards.ts` (SplitGuard). `docio.ts` (`docToMarkdown`, `docJsonFromMarkdown`). `modelMarkdown.ts` (`normalizeModelMarkdown`) rewrites multiple-choice forms from model output into `- [ ]` / `- [x]` syntax before insert. Plus commands, formatting, keymaps, numbering (`numbering.ts`; `numberingPlugin.ts` draws the question-number widgets), page style, split config, selection popover, page handlers, initial doc, UI extensions. `suggest/` holds AI edit suggestions (`plugin.ts` state, `card.ts` cards, `apply.ts` accept/reject, `edit.ts` request, `snapshot.ts`, `diff.ts`), and `ReviewBar.tsx` is the accept/reject bar. `pageBreaks.ts` and `pageBreaksPlugin.ts` draw page gaps and A4 page breaks. `listLines.ts` toggles list lines and `TableHandle.tsx` is the table handle. |
| `assistant/` | `AssistantPane.tsx`, `ChatTabs.tsx`, `ChatView.tsx`, `SkillsTab.tsx`, `SlashList.tsx`, `OfflineNotice.tsx` and `aiNotice.ts` (offline or busy notice with Retry). `chatStore.ts` (zustand `useChats`). `editEntry.ts` (zustand `useEditEntry`: edit mode, scope, lock). `ContextRing.tsx` and `contextUsage.ts` (context-window ring). `reply.ts`. `ChatMarkdown.tsx` renders assistant replies as Markdown (tables included). `pageBridge.ts` (`setPageHandlers`, `runPageSkill`, `insertFromChat`). |
| `files/` | `exportActions.ts` (`loadExportPlan`, `runExport`). `fileio.ts` (File System Access API open/save, `hasFsAccess`). `fileActions.ts` (`newDocument`, `openDocument`, `saveDocument`, `saveCheckpoint`, `restoreCheckpoint`). `autosave.ts` (`startAutosave`, `flushAutosave`). `fsaccess.d.ts` (type shims). |
| `state/` | `store.ts` (zustand `useApp`: theme, day/night palette, background, spellcheck, tokenStats, view, assistantWidth, assistantCollapsed, saveState, fileName, dirty, editor, toast, warnings, docMeta, dialog). `persist.ts` (`loadJson`/`saveJson` to `localStorage`, prefix `docuteach:v1:`). |
| `ui/` | Shell, MenuBar, Toolbar, ViewTabs, Popover, ConfirmHost, dialogs (Dialog, CheckpointsDialog, HelpDialogs, LessonsDialog, PageStyleDialog, SplitDialog, SkillsDialog, ModelsDialog with ModelEditForm, ThemeDialog for the colour theme). The toolbar holds font and size controls and the Export menu. The MenuBar Edit menu has Number questions. The MenuBar Options menu groups Editor, Theme, Skills and Models, with the opt-in "Show token stats" toggle. |
| `styles/` | `app.css`, `page.css`, `tokens.css`. `tokens.css` holds the colour themes: `data-theme` (light or dark) and `data-palette` on the root element pick one of five day and five night palettes. |

## Custom blocks and the Markdown round trip

Four custom block/inline constructs are defined. The round trip (parse → serialise) is covered by golden tests.

| Block | Markdown syntax | ProseMirror node |
|-------|----------------|-----------------|
| Teacher note | Fenced `::: teacher {tag="CCQ" unlocked="true"}` … `:::` (tag and `unlocked` optional; `unlocked` lets the local model edit the note; the lock button on each note in edit view sets it) | `TeacherNote` |
| Blank (answer) | Inline `{{answer}}`; alternatives separated by `\|` e.g. `{{has lived \| 's lived}}`; escapes `\|`, `\}`, `\\`, `\{{` | `Blank` (attr `answers[]`) |
| Multiple choice | Question paragraph followed by `- [ ] option` / `- [x] correct option` list | `Mcq` (attr `multi`), `McqQuestion`, `McqOption` (attr `correct`) |
| Split point | `<!-- split: Homework starts here -->` | `SplitPoint` (attr `label`) |

**Tables.** GFM pipe tables. Column alignment (`:---`, `:---:`, `---:`) round-trips through parse, editor and serialiser.

**Unknown content.** Code fences, block quotes, HTML comments, and other unrecognised structures are captured as `RawBlock` and written back verbatim.

**Front matter.** YAML front matter is parsed into `DocMeta`. Recognised keys include `lesson_type`, `split`, `page` (font, size, line, margins_mm); unknown keys are preserved. Broken YAML is kept intact: `DocMeta` stores both `raw` and `data` with a `broken` flag.

## Views

Three view modes are available via `ViewTabs` (state `view`: `'edit' | 'student' | 'teacher'`):

- **Edit** – `EditorPane` renders the TipTap editable document.
- **Teacher** – `PreviewPane` in read-only mode; shows all content including teacher notes, correct answers, and distractors.
- **Student** – `PreviewPane` in read-only mode; renders the output of `projectStudent(doc)`.

`projectStudent` is a pure function that builds a new document:

- Every `TeacherNote` and `RawBlock` is removed at any depth.
- Every `Blank`'s `answers` array is set to `[]`.
- Every `McqOption`'s `correct` attr is set to `false`.
- `Mcq.multi` is preserved (multi = more than one correct option).
- `DocMeta` is replaced by an empty meta.
- `SplitPoint` is kept.
- If the result is empty, one empty paragraph is inserted.

The student view therefore never receives teacher content.

## API layer

`api/index.ts` exports `api`, an object implementing `DocuTeachApi`: the HTTP client when the page carries a backend token, otherwise the mock. The UI imports `api` only. The mock lives in `api/mock/` and uses `localStorage`:

- **Docs** – stored under key prefix `docuteach:v1:doc:`. Autosave writes under id `'draft'` via `api.docs.save('draft', markdown)`.
- **Checkpoints** – stored under key prefix `docuteach:v1:ckpt:`. Cap of 50 per document; the `'Before open'` checkpoint is exempt from the UI cap check.
- **Chat** – `chat.stream(req, signal)` returns an `AsyncIterable<StreamEvent>`. The mock simulates token-by-token delivery with short random delays and a simulated model swap/load time (`api/mock/config.ts`).
- **Models / Skills** – in-memory mock data (`api/mock/models.ts`, `api/mock/skills.ts`); changes are lost on reload. `api/mock/config.ts` holds the simulated timings and an abortable `sleep`.

## Streaming insert (one undo step)

`startPageStream(editor, {skill, selection?, prompt?})`:

1. Anchors a ProseMirror plugin slot (`StreamSlot` extension, keyed by `slotKey`) at the end of the top-level block of the selection.
2. Appended tokens are held in plugin state and rendered as a widget; the meta flag `addToHistory: false` keeps them out of the history stack.
3. On completion the accumulated text is normalised (`normalizeModelMarkdown`), parsed (`parseFragment`), validated (`validateFragment`), and inserted by `insertFragment` in a single transaction. Invalid output falls back to plain paragraphs (`plainParagraphs`).
4. The single transaction is **one undo step**.
5. Before the insert a checkpoint named `Before AI: <skill>` is saved, so the draft can be rolled back.

Constraints:

- Only one stream runs at a time; a second attempt toasts "Wait for the current draft or press Esc".
- Escape cancels via `cancelPageStream`; an aborted request cancels the upstream LLM request.
- Stream errors `llm_offline`, `llm_busy` and `chat_busy` set the assistant notice (`aiNotice.ts`) instead of inserting anything.
- If the user presses Undo while streaming, `history.ts` first calls the registered draft canceller (`setDraftCanceller`) to abort the stream, then proceeds with the normal undo.

## AI page edits (suggestions)

Edit mode asks the model for changes to the lesson and shows them as suggestions. Nothing changes in the document until the teacher accepts a suggestion.

1. The assistant sends `POST /chat/stream` with `mode: 'edit'` and an `edit` payload: `instruction` (max 2000 chars), `scope` (`selection`, `section` or `lesson`), `allowProtected`, an optional `part` (part number and outline), and `blocks` (`id` `b<n>`, `kind`, `md`, `role` `edit` or `context`).
2. `edits/prompt.py` builds the messages. `llm/stream.py` runs them through `EditRun` (`edits/run.py`). `edits/ops.py` parses the output into `replace`, `insert`, `delete` and `move` operations plus a reply. `edits/check.py` checks each operation against the blocks and the protection rules. A failing operation is skipped with a code (`edit_skipped` event).
3. The stream ends with a `done` event: counts of edits and skipped operations, and flags for no change and large rewrite.
4. `editor/suggest/` shows each operation as a card in the page (`plugin.ts` keeps the state; a pending replace, delete or move whose target text is removed by a later edit is marked `stale`). Accept applies one item, reject removes it, and `ReviewBar.tsx` accepts or rejects all. Undo brings back rejected items.
5. The first accept for a request saves an auto checkpoint named `Before AI edit: <request>`. Each accepted change is one undo step.

## Save, autosave and checkpoints

- **Manual save/open** – File menu uses the File System Access API (`fileio.ts`). When the API is unavailable (`hasFsAccess()` is false), open falls back to a hidden file input.
- **Autosave** – `startAutosave` (default debounce 800 ms) writes the current Markdown to the mock docs store under id `'draft'`. `saveState` reflects `'saved' | 'saving' | 'error'`. `flushAutosave` forces an immediate write.
- **Checkpoints** – `saveCheckpoint` prompts for a name (default `"Checkpoint HH:MM"`) and calls `api.docs.checkpoints.create`. A `'Before open'` checkpoint is created before opening or creating a document. The cap is 50; before exceeding it the UI asks for confirmation to remove the oldest. `CheckpointsDialog` lists checkpoints and calls `restoreCheckpoint`, which replaces the document content in one transaction (history is closed before and after, so it is a separate undo step). Automatic checkpoints (`auto: true`) are made before streamed drafts (`Before AI: <skill>`), chat inserts and accepted AI edits.

## State stores

Two zustand stores:

- **`useApp`** (`state/store.ts`) – application-level UI state: `theme`, `dayPalette`, `nightPalette`, `background`, `spellcheck`, `tokenStats`, `view`, `assistantWidth`, `assistantCollapsed`, `saveState`, `fileName`, `dirty`, `editor` reference, `toast`, `warnings`, `docMeta`, `dialog`. Persistence helpers in `state/persist.ts` read/write `localStorage` with prefix `docuteach:v1:`.
- **`useChats`** (`assistant/chatStore.ts`) – assistant chats, model status, skill list and the active pane tab. Chat messages can carry token `stats` (in, out, tokens/s) from the `stats` stream event.
- **`useEditEntry`** (`assistant/editEntry.ts`) – edit mode on/off, scope and lock, per chat.

## Network rule (CSP)

`frontend/index.html` carries a `Content-Security-Policy` meta tag:

```
default-src 'self';
connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*;
font-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
script-src 'self';
object-src 'none'
```

Network connections are allowed only to the page origin and to loopback hosts (`localhost`, `127.0.0.1`) on any port, for the local backend and LLM endpoint. Fonts are bundled via `@fontsource` (the list is in `editor/fonts.json`), with matching variable fonts in `backend/docuteach/export/fonts/` for the PDF. `test/network.test.ts` scans `index.html` and all `src/` files to assert no non-local URLs appear.

## Backend

`backend/docuteach/` — Python 3.12, FastAPI, strict pyright, ruff, pytest; golden tests in `backend/tests/golden`.

`app.py` app factory · `config.py` `Settings` (llm_base_url `http://127.0.0.1:8080`, slots 4, checkpoint_cap 50, trash_days 30, export_timeout_s 120, model_allowlist `["byteshape"]`, allow_all_models `False`, llama_server_path `""`) · `security.py` token+host middleware (`X-DocuTeach-Token`; loopback hosts `127.0.0.1`, `localhost` and `[::1]`) · `errors.py` `ApiError` · `logs.py` local logs

**Settings sources.** Environment variables (for example `DOCUTEACH_LLAMA_SERVER_PATH` for `llama_server_path`), then `settings.json` in the data dir, which overrides them.

**Data dir files** (the desktop app keeps them in `%APPDATA%\DocuTeach\data`):

- `lessons/` lesson Markdown and checkpoints; `skills/` user skill files, `.trash/` and `_state.json` (built-in hides)
- `models.json` model settings: `default`, `llama_server_path`, `overlay_dir`
- `llama-swap-docuteach.yaml` the llama-swap overlay for custom models; the file is written to `overlay_dir` when one is set. Its history is kept in `llama-swap-docuteach.yaml.history/` (last 20 versions, used by Undo).

### `md/`
- Reader/writer mirroring frontend model: parser, frontmatter, inline spans (incl. font/size), blank/block/table rules, numbering
- `project.py` student projection (removes teacher content) · `fonts.json` font list

### `store/`
- Lessons on disk under data dir (`lessons/`), checkpoints, trash (30 d), D-07 import

### `api/`
- `/lessons` (list, create, patch, delete, restore) · `/lessons/{id}/doc` (get, put) · `/lessons/{id}/checkpoints` (list, create, delete, restore) · `/lessons/{id}/chats` (get, put)
- `/models` · `/models/current` · `/models/{id}/context` · `/models/select` · `/models/manage` · `/models/default` · `/models/unload` · `/models/server-path` · `/models/overlay-dir`
- `/models/custom` (create) · `/models/custom/{id}` (get, put, delete) · `/models/custom/preview` (YAML preview) · `/models/custom/undo`
- `/skills` (list, create) · `/skills/manage` · `/skills/import/preview` · `/skills/import/commit` · `/skills/restore-defaults` · `/skills/trash/{id}/restore` · `/skills/{slug}/file` · `/skills/{slug}/reset` · `/skills/{slug}` (delete)
- `/status` · `/fonts/open` (opens the bundled fonts folder in the OS file manager)
- `/chat/stream` (also edit mode) · `/chats/{id}/release` · `/export/plan` · `/export`

### `llm/`
- `client.py` `LlmClient` → local llama-swap; requests ask for `include_usage` · `models.py` lists/selects (allowlist unless `allow_all_models`), manages the default, unloads models; the llama-server path is read from `models.json`, then settings
- `overlay.py` `Overlay` writes custom model entries to the llama-swap YAML. A form (`ModelForm`) is validated (id `^[a-z][a-z0-9-]{1,31}$`, `llama-server.exe` path), turned into a command line, and saved with a history entry for undo. The overlay goes to `overlay_dir` when set.
- `slots.py` `SlotTable` one-chat-one-KV-slot (LRU, never evicts generating) · `stream.py` `LlmService` token streaming; emits a `stats` event (input and output tokens, tokens/s from the llama-server timings) after the reply · `replyTo` cuts the history to the replied-to branch (`_branch_messages`; plain questions only) · the default system prompt asks for Markdown pipe tables (`TABLE_PROMPT`)

### `edits/`
- `__init__.py` `EditPayload` / `EditBlock` request models · `prompt.py` edit prompt · `ops.py` parser for model output · `check.py` `OpChecker` (checks and protection) · `run.py` `EditRun` turns parser output into stream events. See "AI page edits" above.

### `skills/`
- `format.py` skill file format: a `.md` file with a `---` header holding the keys `command`, `name`, `description`, `insertAs` (`teacherNote`, `blanks` or `text`) and `tag`; max 16 KB; `/edit` is reserved
- `store.py` `SkillFolder` reads the built-in skills (`builtin/`: `ccq.md`, `drills.md`, `pitfalls.md`) and the user files in `data/skills/`
- `manage.py` `SkillManager` creates, imports, deletes and restores skills. Deleted files go to `skills/.trash/` and are purged after `trash_days`; built-ins can be hidden, reset or restored to defaults
- `registry.py` `SkillRegistry` builds prompts from the skills (CCQ note, drills, pitfalls…) · `validate.py` checks output vs schema; invalid → plain text

### `export/`
- `split.py` plan: parts target `student_pdf` or `teacher_docx`. Modes: none (Student + Teacher copy) / page ranges (Part N + Teacher guide) / split marker (Lesson, Homework + Teacher guide) / default (one part, both targets)
- Student PDF: `typst_render.py`/`typst_inline.py` via `typst`; `fonts/` variable fonts; pypdf cuts ranges
- Teacher DOCX: `docx_render.py`/`docx_inline.py`/`docx_xml.py` via python-docx; `answer_key.py` builds key; `names.py` sanitises
- Question numbers (`md/numbering.py` `number_blocks`) label questions in both the PDF and the DOCX (answer key included). Tables keep alignment, column widths (`table_layout.py`), header row and shading in both
- POST `/export`: thread + gate (`export_timeout_s`); returns file + `X-DocuTeach-Warnings` (URL-encoded JSON)

## Desktop app

`desktop/` Windows app; data in `%APPDATA%\DocuTeach\data`. Not code-signed.

- `launcher.py` starts loopback server, opens pywebview (WebView2) or browser fallback
- `server.py` serves built frontend, mounts backend under `/api` · `store.py` file-backed KV + instance lock
- `--selftest` (`DocuTeach.exe --selftest`): GET `/`, sample lesson, store round-trip, token rejection, GET `/api/status` → prints `selftest ok`
- `build.py`: builds frontend → PyInstaller (`DocuTeach.spec`, which bundles the frontend, the export fonts, `md/fonts.json` and `skills/builtin`) → scans non-local URLs → selftest → zip + SHA256SUMS

## Tests

Test files live in `frontend/test/` (vitest + jsdom + testing-library). Fixtures are in `frontend/test/fixtures/*.md`; normalisation pairs in `frontend/test/normalize/*.in.md` / `*.out.md`. A shared `helpers.ts` provides utilities.

| Area | Test files |
|------|-----------|
| Markdown round trip | `roundtrip.test.ts`, `property.test.ts`, fixtures, normalise pairs |
| Markdown unit | `parse`, `serialize`, `serialize-inline`, `inline`, `escape`, `frontmatter`, `rules-*` |
| Editor / ProseMirror | `schema`, `commands`, `formatting`, `guards`, `numbering`, `numbering-editor`, `model-markdown`, `table-align`, `pageStyle`, `splitConfig`, `project`, `docio`, `stream` |
| API / Assistant | `chatStore`, `assistant.test.tsx`, `chat-markdown`, `copy-selection`, `mock-api`, `mock-docs`, `edit-entry`, `contextUsage`, `reply-spellcheck`, `token-stats` |
| AI edits | `suggest-core`, `suggest-ui`, `bulkEdit`, `bulkAlign` |
| Files | `autosave`, `fileio`, `fileActions`, `checkpoints-dialog` |
| UI | `toolbar`, `dialogs`, `globalKeys`, `theme`, `tokens`, `skills-models-dialogs`, `models-dialog-overlay`, `unload-model`, `selectionPopover`, `tableHandle` |
| Editor layout | `pageBreaks`, `pageSplitInput`, `listMultiLine` |
| Smoke / integration | `app.smoke`, `page-stream.smoke`, `preview.smoke` |
| Network (CSP) | `network.test.ts` |

Run: `pnpm test` (from `frontend/`). Type-check: `pnpm typecheck`. Lint: `pnpm lint`.

Backend tests are in `backend/tests/` (pytest; golden tests in `backend/tests/golden`). They cover skill files, skill management and API, the skill registry, model units and the overlay directory. Tests marked `llm` need the real model and are skipped by default.