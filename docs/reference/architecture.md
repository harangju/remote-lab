# Architecture

## High-level shape

```text
Browser → Caddy (HTTPS) → FastAPI (uvicorn)
                             ├── REST API
                             ├── WebSocket
                             └── Static frontend assets
```

## Backend

Key backend files:

- `backend/server.py` — FastAPI app, WebSocket handler, REST API, static file serving
- `backend/agents.py` — agent configuration, model fallback, system prompts
- `backend/tools.py` — bash, file, search, and web tools
- `backend/context.py` — injects project context such as `CLAUDE.md` and directory tree
- `backend/compact.py` — summarizes older messages when context gets large
- `backend/storage.py` — flat-file persistence for projects and conversations
- `backend/models.py` — Pydantic models for REST API
- `backend/protocol.py` — WebSocket event models

## Frontend

Key frontend files:

- `frontend/src/main.tsx` — app entry, routing, auth gate
- `frontend/src/api.ts` — REST and WebSocket client
- `frontend/src/views/Chat.tsx` — main chat UI
- `frontend/src/views/ProjectList.tsx` — project list page
- `frontend/src/views/ConvoList.tsx` — conversation list page
- `frontend/src/components/FilePanel.tsx` — side panel for viewing and editing files
- `frontend/src/components/CodeMirrorEditor.tsx` — full editor, lazy-loaded
- `frontend/src/components/FileFinder.tsx` — file finder modal

## Persistence model

Remote Lab uses JSON files on disk instead of a database.

```text
data/
  projects.json
  conversations/{id}.meta.json
  conversations/{id}.jsonl
  conversations/{id}.agent.json
```

This keeps the system easy to inspect, back up, and modify.

## Execution model

A key design choice is that agent runs are decoupled from the browser connection.

The backend runs agent work as an async task. If the browser disconnects, the task can keep running. When the client reconnects, it receives the persisted history and any new streamed events.

## Context management

When a conversation approaches the model context limit, older messages are compacted into a summary. This preserves continuity without sending the full raw history on every turn.

## Project scoping

Each project points to a real directory on disk. Agent tools run relative to that directory and are sandboxed to it.
