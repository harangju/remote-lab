# Remote Lab

A self-hosted AI assistant that runs on your own VPS. Chat UI, file editor, multi-agent collaboration, and agentic tool use — all under your control.

## Why self-host?

- **Privacy** — your conversations and files stay on your machine
- **No rate limits** — use your own API keys directly
- **Full control** — agents have real shell access, file I/O, and tools, scoped to your project directories
- **Always on** — runs 24/7 on a cheap VPS, accessible from anywhere

## What's included

- **Chat UI** with streaming responses, markdown rendering, and inline tool use visualization
- **File editor** with syntax highlighting (CodeMirror, lazy-loaded)
- **Multi-agent system** — define custom agents per project with their own models, system prompts, and tools
- **@mentions** — route messages to specific agents, or let agents @mention each other for autonomous workflows
- **Agent tools** — bash, read/write/edit files, glob, grep, web search
- **Multi-provider LLM** — Claude Sonnet 4.6, Opus 4.6, GPT-5.4, GPT-5-nano, Gemini 2.5 Flash — switchable per conversation or per agent
- **Project scoping** — each project is sandboxed to a directory on disk
- **Context compaction** — automatically summarizes older messages when the context window fills up
- **Persistent agent runs** — agents keep running even if you close the browser; reconnect to pick up where you left off

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
