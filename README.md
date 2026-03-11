# remote-lab

A personal remote development lab. Two services on one VPS:

- **`lab.harangju.com`** — AI coding assistant with chat UI, file editor, and agentic tool use
- **`docs.harangju.com`** — Markdown and HTML document server with access control

## How it works

```
browser → Caddy (HTTPS, port 443) → lab (port 3000) or docs (port 3001)
```

### Lab (`backend/server.py`)

- **`backend/server.py`** — FastAPI app. REST API, WebSocket chat, React frontend serving.
- **`backend/agents.py`** — PydanticAI agent with multi-provider fallback. System prompt sandboxing and usage limits.
- **`backend/tools.py`** — Server-side tools: bash, read/write/edit files, glob, grep.
- **`backend/protocol.py`** — Pydantic models for WebSocket chat events.
- **`backend/models.py`** — Pydantic models for REST API (projects, conversations).
- **`backend/storage.py`** — Flat-file storage for projects and conversations.
- **`frontend/`** — React + TypeScript chat UI, built with Bun.

### Docs (`backend/docs_server.py`)

- **`backend/docs_server.py`** — Standalone FastAPI app. Renders markdown as HTML, serves `.html` files as-is, serves static assets.
- **`docs/`** — Drop `.md` or `.html` files here. They show up on the index page sorted by last modified.

### Shared

- **`Caddyfile`** — Reference copy. The live one is at `/etc/caddy/Caddyfile`.

## Routes

### Lab (`lab.harangju.com`)

| Route | What it does |
|-------|-------------|
| `/` | React chat UI (requires `WS_TOKEN` env var) |
| `/api/projects` | REST API for project management |
| `/api/ws/{convo_id}` | WebSocket endpoint for agent chat (requires auth) |

### Docs (`docs.harangju.com`)

| Route | What it does |
|-------|-------------|
| `/` | Lists all `.md` and `.html` files in `docs/`, sorted by last modified |
| `/:slug` | Renders `docs/{slug}.md` as HTML, or serves `docs/{slug}.html` as-is |

## What's in the docs HTML template

- **MathJax v3** — renders LaTeX math. Inline `$...$` and display `$$...$$`.
- **Hypothesis** — adds inline annotation/commenting sidebar (via hypothes.is embed script).
- **Responsive CSS** — mobile-friendly, dark mode via `prefers-color-scheme`.

## Setup

### 1. Install dependencies

```bash
uv sync
cd frontend && bun install && bun run build
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in your API keys and token:

```
WS_TOKEN=<generate with: openssl rand -hex 32>
ALLOWED_ORIGIN=https://lab.harangju.com
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=AI...
```

At least one LLM API key is required. The agent uses dynamic fallback based on available API keys.

### 3. Run locally

```bash
uv run uvicorn backend.server:app --host 0.0.0.0 --port 3000       # lab
uv run uvicorn backend.docs_server:app --host 0.0.0.0 --port 3001  # docs
```

## Adding documents

Drop a markdown or HTML file in `docs/`:

```bash
cp ~/notes.md /srv/remote-lab/docs/
cp ~/page.html /srv/remote-lab/docs/
```

Or symlink from another repo:

```bash
ln -s /path/to/other-repo/paper.md /srv/remote-lab/docs/paper.md
```

## Services

Three systemd services run this:

### remote-lab (the chat/agent app)

```
/etc/systemd/system/remote-lab.service
```

```ini
[Unit]
Description=remote-lab
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/srv/remote-lab
EnvironmentFile=/srv/remote-lab/.env
ExecStart=/usr/local/bin/uv run uvicorn backend.server:app --host 0.0.0.0 --port 3000
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
systemctl status remote-lab     # check status
systemctl restart remote-lab    # restart after code changes
journalctl -u remote-lab -f     # tail logs
```

### remote-lab-docs (the document server)

```
/etc/systemd/system/remote-lab-docs.service
```

```ini
[Unit]
Description=remote-lab-docs
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/srv/remote-lab
EnvironmentFile=/srv/remote-lab/.env
ExecStart=/usr/local/bin/uv run uvicorn backend.docs_server:app --host 0.0.0.0 --port 3001
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
systemctl status remote-lab-docs
systemctl restart remote-lab-docs
journalctl -u remote-lab-docs -f
```

### Caddy (reverse proxy + HTTPS)

```
/etc/caddy/Caddyfile
```

Caddy routes each subdomain to its backend and auto-provisions Let's Encrypt TLS certs.

```bash
systemctl status caddy
systemctl reload caddy           # reload after Caddyfile changes
journalctl -u caddy -f
```

## Domain setup

Point two A records at your server IP — Caddy handles HTTPS automatically.

1. Add A records: `lab.yourdomain.com` and `docs.yourdomain.com` → `<your-server-ip>`
2. Update the `Caddyfile` with your domains
3. Reload Caddy: `systemctl reload caddy`

## Access control

Restrict access to individual documents using `docs/.access.json`. Documents not listed are public.

```json
{
  "my-private-doc": ["tok_abc123", "tok_def456"],
  "another-doc": ["tok_abc123"]
}
```

Each key is a document slug, and the value is a list of tokens that grant access. Share the secret link:

```
https://docs.harangju.com/my-private-doc?t=tok_abc123
```

Tokens also work via `Authorization: Bearer tok_abc123` header.

Generate a token:

```bash
openssl rand -hex 16
```

Restricted documents are hidden from the index unless the viewer has a valid token.

## Chat

Visit `https://lab.harangju.com` and enter the token when prompted. It's saved in `localStorage` for subsequent visits.

### Projects and conversations

Create projects to scope agent work to specific directories. Each project can have multiple conversations with persistent history stored as JSONL.

### Multi-provider fallback

The agent dynamically selects providers based on available API keys in `.env`. Configure which providers are available by setting their API keys.

### Agent tools

The agent has access to server-side tools, scoped to the project's directory:

| Tool | What it does |
|------|-------------|
| `bash` | Run shell commands |
| `read_file` | Read file contents |
| `write_file` | Create or overwrite files |
| `edit_file` | Find-and-replace in files |
| `glob` | Find files by pattern |
| `grep` | Search file contents with ripgrep |

### How auth works

- REST API uses `Authorization: Bearer` header
- On WebSocket connect, the client sends `{"type":"auth","token":"..."}` as the first message
- Server validates with constant-time comparison (`hmac.compare_digest`)
- Invalid token closes the connection with code 4401
- `ALLOWED_ORIGIN` rejects cross-origin WebSocket upgrades (prevents CSWSH)
- Only one WebSocket connection at a time (429 if already active)
- Usage limits cap the number of LLM requests per conversation turn
- System prompt guardrails prevent the agent from reading env vars, system configs, or making external network requests
- Symlinks in `docs/` are validated — resolved path must stay inside the docs directory

## Security

Lock down the server to only what's needed — SSH for access and HTTPS for traffic.

```bash
ufw default deny incoming    # block ALL incoming traffic by default
ufw allow 22                 # then poke a hole for SSH
ufw allow 443                # and a hole for HTTPS
ufw enable                   # turn on the firewall
apt install fail2ban         # auto-bans IPs after repeated failed SSH attempts
```

## Dependencies

- **Runtime:** Python 3.11+, [uv](https://docs.astral.sh/uv/), [Bun](https://bun.sh/) (for frontend)
- **Python:** `pydantic-ai` (agent framework), `fastapi` (web server), `uvicorn` (ASGI server), `markdown` (rendering), `python-dotenv` (env config)
- **Frontend:** React, React Router, react-markdown
- **System:** `caddy` (reverse proxy), `ripgrep` (for grep tool)

### Install system dependencies

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
curl -fsSL https://bun.sh/install | bash
apt install ripgrep caddy
```
