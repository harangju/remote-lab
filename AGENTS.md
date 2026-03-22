# Remote Lab

A web-based AI coding assistant with a chat UI, file editor, and agentic tool use.

## Stack

- **Backend**: Python, FastAPI, PydanticAI, uvicorn
- **Frontend**: React + TypeScript, built with Bun
- **LLM**: Claude Sonnet 4.6 (default), Opus 4.6, GPT-5.4, GPT-5-nano, Gemini 2.5 Flash — switchable via `/model` or per-agent
- **Storage**: JSON files in `data/` (no database)
- **Reverse proxy**: Caddy (HTTPS + WebSocket)
- **Process**: systemd (`remote-lab.service`)

## Commands

- `uv run uvicorn backend.server:app` — start the server
- `cd frontend && bun run build` — build the frontend to `frontend/dist/`
- `sudo systemctl restart remote-lab` — restart the main service
- `sudo systemctl restart remote-lab-docs` — restart the docs service (port 3001)

## Data Layout

```
data/
  projects.json                       — list of project objects
  conversations/{id}.meta.json        — conversation metadata
  conversations/{id}.jsonl            — message events (one JSON per line)
  conversations/{id}.agent.json       — serialized PydanticAI message history
```

## Agent Environment

The service runs as `www-data` under systemd. The agent's bash tool inherits the service environment. The `www-data` user's home is `/var/www/`.

- **Git**: `/var/www/.gitconfig`
- **SSH**: `/var/www/.ssh/id_ed25519` — used for `git push`, `git clone`. Server auto-converts HTTPS GitHub URLs to SSH.
- **GitHub CLI**: Authenticated via `gh auth login` as `www-data`. Do **not** set `GH_TOKEN` in `.env`.

## Branching

- **`main`** — stable, deployable. Do not commit directly.
- **`dev`** — active development. Merge to main when stable.

## Conventions

- After frontend changes, rebuild: `cd frontend && bun run build`
- After backend changes, restart: `sudo systemctl restart remote-lab`
- Frontend uses inline styles (React.CSSProperties), no CSS framework
- CSS variables: `--bg`, `--bg-surface`, `--border`, `--text`, `--text-muted`, `--accent`
- Light/dark mode via `prefers-color-scheme`
- Use the mental model → manifest → desired state → delta → implementation workflow for product-shaping work. Get in sync at each step.

## Slides (Marp)

Marp CLI is installed globally. Compile slide decks: `marp --html slides.md -o /srv/remote-lab/public/slides.html`
