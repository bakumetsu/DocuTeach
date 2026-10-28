# DocuTeach Frontend Architecture

## Overview

DocuTeach is a local, private editor for an English grammar teacher. A single Markdown document is the source of truth; answers live only inside the document (`{{answer}}` blanks, `[x]` options). The frontend is the only code that exists today. It is a React 19 single-page application built with Vite, using TipTap 3 (ProseMirror) as the editing engine. A mock backend runs in the browser via `localStorage`. No server code, no export pipeline, and no real LLM integration exist yet; those are planned.

Product invariants enforced in code:

- Student output never exposes teacher content.
- Nothing leaves the PC except requests to a local LLM endpoint.
- No destructive action without Undo; a streamed insert is exactly one undo step.

## Source layout

All source lives under `frontend/src/`.

| Folder | Responsibility |
|--------|---------------|
| `main.tsx`, `App.tsx` | Entry point and root component. |
| `api/` | `types.ts` defines `interface DocuTeachApi` (models, `chat.stream`, chats, skills, docs with checkpoints). `index.ts` exports `api = mockApi`. `api/mock/` implements the mock (chat, config, docs, models, script, skills). Docs and checkpoints are persisted in `localStorage` under keys prefixed `docuteach:v1:doc:` and `docuteach:v1:ckpt:`. |
| `markdown/` | Pure Markdown parse/serialise layer. `parse.ts` (`parseMarkdown`, `parseFragment`), `serialize.ts`, `serialize-inline.ts`, `blocks.ts`, `inline.ts`, `escape.ts`, `frontmatter.ts` (YAML → `Meta`), `md.ts` (`createMd`: markdown-it with `html:false`, `linkify:false`), `rules/` (custom markdown-it rules for blank, comment, div, mark, raw, span, table). |
| `editor/` | TipTap integration. `extensions.ts` (extension list, StarterKit). `nodes/` (Align, Blank, DocMeta, Mcq/McqQuestion/McqOption, RawBlock, SplitPoint, TeacherNote). `nodeviews/` (React views for Blank, Mcq, Raw, Split, TeacherNote). `EditorPane.tsx`, `PreviewPane.tsx`. `project.ts` (`projectStudent`). `ViewContext.ts` (`ViewMode`). `stream.ts` (StreamSlot, `startPageStream`, `cancelPageStream`). `insert.ts` (`validateFragment`, `plainParagraphs`, `insertFragment`). `history.ts` (revert/redo, `setDraftCanceller`). `guards.ts` (SplitGuard). `docio.ts` (`docToMarkdown`, `docJsonFromMarkdown`). Plus commands, formatting, keymaps, numbering, page style, split config, selection popover, page handlers, initial doc, UI extensions. |
| `assistant/` | `AssistantPane.tsx`, `ChatTabs.tsx`, `ChatView.tsx`, `SkillsTab.tsx`, `SlashList.tsx`. `chatStore.ts` (zustand `useChats`). `pageBridge.ts` (`setPageHandlers`, `runPageSkill`, `insertFromChat`). |
| `files/` | `fileio.ts` (File System Access API open/save, `hasFsAccess`). `fileActions.ts` (`newDocument`, `openDocument`, `saveDocument`, `saveCheckpoint`, `restoreCheckpoint`). `autosave.ts` (`startAutosave`, `flushAutosave`). `fsaccess.d.ts` (type shims). |
| `state/` | `store.ts` (zustand `useApp`: theme, view, assistantWidth, assistantCollapsed, saveState, fileName, dirty, editor, toast, warnings, docMeta, dialog). `persist.ts` (`loadJson`/`saveJson` to `localStorage`, prefix `docuteach:v1:`). |
| `ui/` | Shell, MenuBar, Toolbar, ViewTabs, Popover, ConfirmHost, dialogs (Dialog, CheckpointsDialog, HelpDialogs, PageStyleDialog, SplitDialog). |
| `styles/` | `app.css`, `page.css`, `tokens.css`. |

## Custom blocks and the Markdown round trip

Four custom block/inline constructs are defined. The round trip (parse → serialise) is covered by golden tests.

| Block | Markdown syntax | ProseMirror node |
|-------|----------------|-----------------|
| Teacher note | Fenced `::: teacher {tag="CCQ"}` … `:::` (tag optional) | `TeacherNote` |
| Blank (answer) | Inline `{{answer}}`; alternatives separated by `\|` e.g. `{{has lived \| 's lived}}`; escapes `\|`, `\}`, `\\`, `\{{` | `Blank` (attr `answers[]`) |
| Multiple choice | Question paragraph followed by `- [ ] option` / `- [x] correct option` list | `Mcq` (attr `multi`), `McqQuestion`, `McqOption` (attr `correct`) |
| Split point | `<!-- split: Homework starts here -->` | `SplitPoint` (attr `label`) |

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

## Mock API layer

`api/index.ts` exports `api = mockApi`, an object implementing `DocuTeachApi`; the UI imports `api` only, so it does not depend on the mock directly. The mock lives in `api/mock/` and uses `localStorage`:

- **Docs** – stored under key prefix `docuteach:v1:doc:`. Autosave writes under id `'draft'` via `api.docs.save('draft', markdown)`.
- **Checkpoints** – stored under key prefix `docuteach:v1:ckpt:`. Cap of 50 per document; the `'Before open'` checkpoint is exempt from the UI cap check.
- **Chat** – `chat.stream(req, signal)` returns an `AsyncIterable<StreamEvent>`. The mock simulates token-by-token delivery with short random delays and a simulated model swap/load time (`api/mock/config.ts`).
- **Models / Skills** – static mock data. `api/mock/config.ts` holds the simulated timings and an abortable `sleep`.

## Streaming insert (one undo step)

`startPageStream(editor, {skill, selection?, prompt?})`:

1. Anchors a ProseMirror plugin slot (`StreamSlot` extension, keyed by `slotKey`) at the end of the top-level block of the selection.
2. Appended tokens are held in plugin state and rendered as a widget; the meta flag `addToHistory: false` keeps them out of the history stack.
3. On completion the accumulated text is parsed (`parseFragment`), validated (`validateFragment`), and inserted by `insertFragment` in a single transaction. Invalid output falls back to plain paragraphs (`plainParagraphs`).
4. The single transaction is **one undo step**.

Constraints:

- Only one stream runs at a time; a second attempt toasts "Wait for the current draft or press Esc".
- Escape cancels via `cancelPageStream`.
- If the user presses Undo while streaming, `history.ts` first calls the registered draft canceller (`setDraftCanceller`) to abort the stream, then proceeds with the normal undo.

## Save, autosave and checkpoints

- **Manual save/open** – File menu uses the File System Access API (`fileio.ts`). When the API is unavailable (`hasFsAccess()` is false), open falls back to a hidden file input.
- **Autosave** – `startAutosave` (default debounce 800 ms) writes the current Markdown to the mock docs store under id `'draft'`. `saveState` reflects `'saved' | 'saving' | 'error'`. `flushAutosave` forces an immediate write.
- **Checkpoints** – `saveCheckpoint` prompts for a name (default `"Checkpoint HH:MM"`) and calls `api.docs.checkpoints.create`. A `'Before open'` checkpoint is created before opening or creating a document. The cap is 50; before exceeding it the UI asks for confirmation to remove the oldest. `CheckpointsDialog` lists checkpoints and calls `restoreCheckpoint`, which replaces the document content in one transaction (history is closed before and after, so it is a separate undo step).

## State stores

Two zustand stores:

- **`useApp`** (`state/store.ts`) – application-level UI state: `theme`, `view`, `assistantWidth`, `assistantCollapsed`, `saveState`, `fileName`, `dirty`, `editor` reference, `toast`, `warnings`, `docMeta`, `dialog`. Persistence helpers in `state/persist.ts` read/write `localStorage` with prefix `docuteach:v1:`.
- **`useChats`** (`assistant/chatStore.ts`) – assistant chats, model status, skill list and the active pane tab.

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

Network connections are allowed only to the page origin and to loopback hosts (`localhost`, `127.0.0.1`) on any port, for the planned local LLM endpoint. Fonts are bundled via `@fontsource` (noto-sans, noto-serif). `test/network.test.ts` scans `index.html` and all `src/` files to assert no non-local URLs appear.

## Tests

Test files live in `frontend/test/` (vitest + jsdom + testing-library). Fixtures are in `frontend/test/fixtures/*.md`; normalisation pairs in `frontend/test/normalize/*.in.md` / `*.out.md`. A shared `helpers.ts` provides utilities.

| Area | Test files |
|------|-----------|
| Markdown round trip | `roundtrip.test.ts`, `property.test.ts`, fixtures, normalise pairs |
| Markdown unit | `parse`, `serialize`, `serialize-inline`, `inline`, `escape`, `frontmatter`, `rules-*` |
| Editor / ProseMirror | `schema`, `commands`, `formatting`, `guards`, `numbering`, `pageStyle`, `splitConfig`, `project`, `docio`, `stream` |
| API / Assistant | `chatStore`, `assistant.test.tsx`, `mock-api`, `mock-docs` |
| Files | `autosave`, `fileio`, `fileActions`, `checkpoints-dialog` |
| UI | `toolbar`, `dialogs`, `globalKeys` |
| Smoke / integration | `app.smoke`, `page-stream.smoke`, `preview.smoke` |
| Network (CSP) | `network.test.ts` |

Run: `pnpm test` (from `frontend/`). Type-check: `pnpm typecheck`. Lint: `pnpm lint`.