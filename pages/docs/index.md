# Remote Lab

A self-hosted AI coding assistant with a chat UI, file editor, and agentic tool use — running on your own VPS.

## Why self-host?

- **Privacy** — your code and conversations stay on your machine
- **No rate limits** — use your own API keys directly
- **Full control** — the agent has real shell access, file I/O, and tools, scoped to your project directories
- **Always on** — runs 24/7 on a cheap VPS, accessible from anywhere

## What's included

- Chat UI with streaming responses and tool use visualization
- File editor with syntax highlighting
- Agent tools: bash, read/write/edit files, glob, grep, web search
- Multi-provider LLM support (Claude, OpenAI, Google)
- Project scoping — each project is sandboxed to a directory
- Automatic context compaction when conversations get long

## Architecture

```
Browser → Caddy (HTTPS) → FastAPI (uvicorn)
                             ├── REST API (projects, conversations)
                             ├── WebSocket (streaming agent chat)
                             └── Static files (React frontend)
```

| Layer | Tech |
|-------|------|
| Backend | Python, FastAPI, PydanticAI |
| Frontend | React + TypeScript, built with Bun |
| Reverse proxy | Caddy (automatic HTTPS via Let's Encrypt) |
| Storage | JSON files on disk (no database) |
