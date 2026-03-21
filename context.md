# Current context

## Product direction
- Product-design workflow is explicit in `AGENTS.md`: Mental model → Manifest → Desired state → Delta → Implementation.
- Current UX exploration centers on Issue #36: documents should feel primary and inhabitable, not auxiliary.
- Desired mode model is converging on:
  - Project mode
  - File-only mode
  - Conversation mode
- Important interaction consequences already established:
  - Project mode opens files explicitly (`Cmd+P`, file button, open-file flow).
  - File-only mode is a real standalone surface.
  - Conversation mode can move cleanly to/from file-only mode while preserving the active file via `?path=`.

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

## Styling / frontend discipline
- Frontend uses inline styles with semantic tokens and shared primitives from `frontend/src/styles.ts`.
- `docs/style-guide.md` documents the intended styling discipline.
- CodeMirror now owns editor state properly, with undo/redo history enabled.

## Docs / ops notes
- Docs now clarify Caddy setup, explicit `uv` install path, restart commands, and `www-data` ownership needs under `/var/www`.
- Marp is installed globally and HTML slide outputs in `public/` are served at the site root.

## Current diagnosis relevant to looping/runs
- `context.md` had grown into a changelog-like prompt artifact and was pruned down for relevance.
- The more important loop cause is run lifecycle behavior, not `context.md` size alone:
  - interrupted runs emit recoverable `run-error`
  - `session.run` cleanup is delayed
  - reconnect/reload restores prior history and project instructions
  - this can encourage the model to reconstruct and repeat the same inspection pattern after interruption
- Chat rendering may also feel repetitive because assistant text streams incrementally while tool events interleave, then history reload/merge can make the same content feel repeated even when it is partly a live-stream + rebuild effect.
