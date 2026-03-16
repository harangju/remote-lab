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
- `sudo systemctl restart remote-lab` — restart the main service
- `sudo systemctl restart remote-lab-docs` — restart the docs service (port 3001)
- `sudo systemctl restart remote-lab remote-lab-docs` — restart both

## Architecture

```
backend/
  server.py      — FastAPI app, WebSocket handler, REST API, static file serving
  docs_server.py — Docs site server (port 3001, systemd: remote-lab-docs)
  agents.py     — PydanticAI agent config, model fallback, system prompt
  tools.py      — Agent tools: bash, read_file, write_file, edit_file, glob, grep, web_search
  context.py    — Project context injection (AGENTS.md, directory tree)
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

## Agent Environment

The service runs as `www-data` under systemd. The agent's bash tool inherits the service's environment via `dict(os.environ)`. The `www-data` user's home is `/var/www/`, so standard dotfiles go there:

- **Git identity**: `/var/www/.gitconfig` — standard `~/.gitconfig` for the `www-data` user.
- **SSH**: `/var/www/.ssh/id_ed25519` — default SSH key, used for `git push`, `git clone`, etc. The server also auto-converts HTTPS GitHub URLs to SSH for project cloning.
- **PATH**: Extended in the systemd unit (`/etc/systemd/system/remote-lab.service`) to include `/root/.bun/bin` since bun is not installed system-wide.

To provision a new server:

1. Set up `/var/www/.gitconfig` with agent's git identity
2. Copy a GitHub-authorized SSH key to `/var/www/.ssh/id_ed25519` (owner `www-data`, mode `600`)
3. Ensure the systemd unit's `Environment=PATH=...` includes paths for any user-installed CLI tools

## File Permissions

The service runs as `www-data`, but files may be created/edited by other users (e.g. `root` via Claude Code). To prevent `EACCES` errors, POSIX ACLs grant `www-data` read/write on everything under `/srv/remote-lab/`:

```bash
# Applied once — default ACLs auto-propagate to new files/directories:
sudo setfacl -R -m u:www-data:rwX /srv/remote-lab
sudo setfacl -R -d -m u:www-data:rwX /srv/remote-lab
```

## Slides (Marp)

[Marp CLI](https://marp.app/) is installed globally (`bun install -g`). Use it to compile Markdown slide decks to self-contained HTML presentations served from `public/`.

```bash
marp --html slides.md -o /srv/remote-lab/public/slides.html
```

Source files use standard Markdown with `marp: true` front matter. Slides are separated by `---`. Built HTML files in `public/` are served at the site root (e.g. `/week1.html`).

## Conventions

- **Align before acting** — understand the problem and agree on the approach before making changes. Ask questions, don't assume.
- **When the goal and best option are clear, just do it** — don't ask the user to choose between options when one is obviously better. Only ask when there's genuine ambiguity or tradeoffs that depend on user preference.
- **Be brief by default** — answer in the fewest words that still fully answer the question. Prefer short paragraphs and bullets over long explanations unless the user asks for detail.
- Use `uv run` for Python, `bun` for frontend (never npm/npx)
- Frontend uses inline styles (React.CSSProperties), no CSS framework
- CSS variables for theming: `--bg`, `--bg-surface`, `--border`, `--text`, `--text-muted`, `--accent`
- Light and dark mode via `prefers-color-scheme` media query
