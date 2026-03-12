# Remote Lab

A web-based AI coding assistant with a chat UI, file editor, and agentic tool use.

## Stack

- **Backend**: Python, FastAPI, PydanticAI, uvicorn
- **Frontend**: React + TypeScript, built with Bun
- **LLM**: Claude Sonnet 4.6 (default), Opus 4.6, GPT-5.4, GPT-5-nano, Gemini 2.5 Flash — switchable globally via `/model` or per-agent
- **Storage**: JSON files in `data/` (no database)
- **Reverse proxy**: Caddy (HTTPS + WebSocket)
- **Process**: systemd (`remote-lab.service`)

## Commands

- `uv run uvicorn backend.server:app` — start the server (use `uv run`, not bare python)
- `cd frontend && bun run build` — build the frontend to `frontend/dist/`
- `sudo systemctl restart remote-lab` — restart the service

## Architecture

```
backend/
  server.py     — FastAPI app, WebSocket handler, REST API, static file serving
  agents.py     — PydanticAI agent config, model fallback, system prompt
  tools.py      — Agent tools: bash, read_file, write_file, edit_file, glob, grep, web_search
  context.py    — Project context injection (CLAUDE.md, directory tree)
  compact.py    — Context window compaction via summarization
  storage.py    — JSON flat-file persistence for projects and conversations
  models.py     — Pydantic models for REST API
  protocol.py   — WebSocket event models (TextDelta, ToolUse, Done, etc.)

frontend/
  src/
    main.tsx              — App entry, routing, auth gate
    api.ts                — REST + WebSocket client
    styles.ts             — CSS-in-JS theme, global styles
    views/
      Chat.tsx            — Main chat UI with streaming, tool chips, file panel
      ProjectList.tsx     — Project list page
      ConvoList.tsx       — Conversation list page
    components/
      CodeBlock.tsx       — Prism syntax-highlighted code blocks (inline chat)
      CodeMirrorEditor.tsx — Full CodeMirror editor (file panel, lazy-loaded)
      FilePanel.tsx       — Side panel for viewing/editing files
      FileFinder.tsx      — Cmd+P fuzzy file finder modal
    hooks/
      usePanel.ts         — Panel state management hook
```

## Key Patterns

- **Agent runs decoupled from WebSocket**: `_run_agent_task` runs as an asyncio task. Clients can disconnect and reconnect without killing the agent.
- **WS protocol**: Events flow as JSON — `auth-ok`, `running`, `text-delta`, `thinking-delta`, `tool-use`, `tool-result`, `done`, `compacted`, `error`.
- **Context compaction**: When context exceeds 80% of the model's limit, older messages are summarized and replaced.
- **Code splitting**: Bun builds with `splitting: true` — CodeMirror is lazy-loaded as a separate chunk (~570KB).
- **Project scoping**: Each project points to a directory on disk. The agent's working directory is set to the project path. Tools are sandboxed to that directory.
- **Model selection**: Global model switchable via `/model` command in chat. Per-agent model override available in agent config (falls back to global model when unset). Available models determined by which API keys are set in the environment.

## Data Layout

```
data/
  projects.json                       — list of project objects
  conversations/{id}.meta.json        — conversation metadata
  conversations/{id}.jsonl            — message events (one JSON per line)
  conversations/{id}.agent.json       — serialized PydanticAI message history
```

## Git Clone Setup

Project creation supports cloning from GitHub URLs. The service runs as `www-data` and uses SSH for cloning. To set this up:

1. Copy a GitHub-authorized SSH key to `/var/www/.ssh/id_ed25519_github`
2. Ensure ownership and permissions: `chown www-data:www-data`, `chmod 600`
3. The server auto-converts HTTPS GitHub URLs to SSH and uses this key via `GIT_SSH_COMMAND`

## Conventions

- Use `uv run` for Python, `bun` for frontend (never npm/npx)
- Frontend uses inline styles (React.CSSProperties), no CSS framework
- CSS variables for theming: `--bg`, `--bg-surface`, `--border`, `--text`, `--text-muted`, `--accent`
- Light and dark mode via `prefers-color-scheme` media query
