# Current context

## Product direction
- Product-design workflow is explicit in `AGENTS.md`: Mental model → Manifest → Desired state → Delta → Implementation.
- Current UX exploration centers on Issue #36: documents should feel primary and inhabitable, not auxiliary.
- Desired mode model is converging on:
  - Project mode
  - File-only mode
  - Conversation mode
- Navigation direction is now shifting from separate project-list / convo-list pages toward a shared app shell with one universal navigator.
- The intended navigator model is:
  - Recent chats across projects
  - Projects as expandable groups
  - Chats nested within projects
- The same navigator should power both desktop and mobile:
  - desktop as a persistent rail
  - mobile as a full-screen drawer/sheet
- Navigator identity is now trending toward project-level identity rather than per-chat identity.

## Key implemented behavior
- Conversation history is paginated: `GET /api/convos/{id}` supports `limit` and `before`; chat loads recent history first and can prepend older messages.
- File-only mode exists and is integrated with conversation mode.
- File finder has shifted toward an explorer-style modal with search-as-filter.
- Chat, project, and file surfaces now share a more consistent icon-button language and tooltip layering behavior.
- File panel supports preview/download flows for `.docx`, `.pdf`, `.html`, and `.htm` with safe sandboxing/authenticated fetch where needed.
- Slash skills are available globally (`/docx`, `/pdf`, `/xlsx`, `/pptx`) via the `activate_skill` tool and packaged skill directories under `data/skills/<name>/...`.
- Conversation auto-titling starts after the first user message.
- `@file` autocomplete refreshes robustly and file-panel saves are conflict-aware.
- Approval chips survive refresh and approved tool output persists correctly through reconnect/history reload.
- Chat/file panel width persists across reloads.
- OpenAI `gpt-5.4`, `gpt-5.4-pro`, `gpt-5.4-mini`, and `gpt-5.4-nano` are tracked in the model limit table; GPT-5.4/pro use a 272K soft compaction threshold for cost control, while keeping the 1.05M real context window.
- Chat header model pill now reads from `agent-start.agent_model`; previously the frontend expected `activeAgent.model` but the websocket event never sent it, so the label fell back to `"model"`.
- Chat header selector is being expanded into a single structured control for both model and effort, with the closed pill showing both values together.
- Effort options are now model-specific in the UI, and `/api/models` exposes per-model effort choices; `gpt-5.4` and `gpt-5.5` are intended to expose `none/low/medium/high/xhigh`.

## Current implementation state
- Added `AppShell` and `AppNavigator` as the first pass at the unified shell.
- Existing routes are now nested under the shell so current URLs still work while navigation is being refactored.
- The first-pass navigator loads projects + per-project convos, shows recent chats, expands projects inline, and renders as a desktop rail or mobile full-screen overlay.
- `ProjectList` is now reduced to a simple shell landing/empty state instead of owning the main projects UI.
- `ConvoList` is now reduced to a lightweight project home / no-chat-selected screen, with quick actions for new chat and open file.
- `Chat` no longer renders the legacy `ChatConvoRail`; chat navigation now relies on the shared app navigator instead of a second desktop-only chat rail.
- Navigator now uses project-level identity chips/colors, recent chats are trimmed down, and archived projects are visible in a collapsible archived section.
- Typecheck passes with `bun x tsc --noEmit --skipLibCheck`, and frontend build succeeds with `bun run build`.
- The shell migration is now structurally in place, though visual polish and cleanup remain.

## Styling / frontend discipline
- Frontend uses inline styles with semantic tokens and shared primitives from `frontend/src/styles.ts`.
- `docs/style-guide.md` documents the intended styling discipline.
- CodeMirror now owns editor state properly, with undo/redo history enabled.

## Current diagnosis relevant to looping/runs
- `context.md` had grown into a changelog-like prompt artifact and was pruned down for relevance.
- The more important loop cause is run lifecycle behavior, not `context.md` size alone:
  - interrupted runs emit recoverable `run-error`
  - `session.run` cleanup is delayed
  - reconnect/reload restores prior history and project instructions
  - this can encourage the model to reconstruct and repeat the same inspection pattern after interruption
- Chat rendering may also feel repetitive because assistant text streams incrementally while tool events interleave, then history reload/merge can make the same content feel repeated even when it is partly a live-stream + rebuild effect.
