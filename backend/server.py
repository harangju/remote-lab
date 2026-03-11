"""FastAPI server: WebSocket chat + markdown doc serving."""

from __future__ import annotations

import asyncio
import hmac
import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

import markdown
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic_ai.messages import (
    ModelRequest,
    ModelResponse,
    ModelMessagesTypeAdapter,
    TextPart,
    ToolCallPart,
    PartStartEvent,
    PartDeltaEvent,
    TextPartDelta,
    ThinkingPartDelta,
    FunctionToolCallEvent,
    FunctionToolResultEvent,
)

from backend.agents import agent, USAGE_LIMITS, get_context_limit
from backend.compact import compact, needs_compaction
from backend.protocol import AuthOk, TextDelta, ThinkingDelta, Done, Running, Compacted, Error
from backend.models import (
    Project, ProjectCreate, ProjectUpdate,
    ConvoMeta, ConvoCreate, ConvoDetail,
    ConvoStatus,
)
from backend import storage
from backend import tools as agent_tools

app = FastAPI()

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DOCS_DIR = Path(__file__).parent.parent / "docs"
WS_TOKEN = os.getenv("WS_TOKEN", "")
ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "")

active_ws: dict[str, WebSocket] = {}  # convo_id → WebSocket

# ---------------------------------------------------------------------------
# Run state — decouples agent runs from WebSocket lifecycle
# ---------------------------------------------------------------------------


@dataclass
class RunState:
    """Tracks an in-flight agent run independently of WebSocket connections."""
    convo_id: str
    task: asyncio.Task | None = None
    events: list[str] = field(default_factory=list)  # ordered JSON strings for replay
    full_text: str = ""
    done_event: dict | None = None
    error_msg: str | None = None
    status: str = "running"  # running | done | error
    subscribers: set = field(default_factory=set)  # set of WebSocket
    # Carry forward after completion
    message_history: list = field(default_factory=list)
    last_context_tokens: int = 0

    async def broadcast(self, msg_str: str):
        """Send a serialized JSON message to all current subscribers."""
        dead: set[WebSocket] = set()
        for ws in self.subscribers:
            try:
                await ws.send_text(msg_str)
            except Exception:
                dead.add(ws)
        self.subscribers -= dead


# convo_id → RunState for in-flight or recently completed runs
active_runs: dict[str, RunState] = {}


async def _run_agent_task(run: RunState, prompt: str, message_history: list, convo_id: str):
    """Execute an agent run in the background, broadcasting to subscribers."""

    async def _emit(msg_str: str):
        """Buffer an event and broadcast to subscribers."""
        run.events.append(msg_str)
        await run.broadcast(msg_str)

    # Disable the per-tool broadcast — we get events from agent.iter() instead
    agent_tools.set_broadcast(None)

    try:
        async with agent.iter(
            prompt,
            message_history=message_history if message_history else None,
            usage_limits=USAGE_LIMITS,
        ) as agent_run:
            async for node in agent_run:
                if agent.is_model_request_node(node):
                    # Stream text deltas from the model response
                    async with node.stream(agent_run.ctx) as stream:
                        async for event in stream:
                            if isinstance(event, PartDeltaEvent):
                                if isinstance(event.delta, TextPartDelta) and event.delta.content_delta:
                                    run.full_text += event.delta.content_delta
                                    await _emit(TextDelta(delta=event.delta.content_delta).model_dump_json())
                                elif isinstance(event.delta, ThinkingPartDelta):
                                    await _emit(ThinkingDelta(delta=event.delta.content_delta or "").model_dump_json())
                elif agent.is_call_tools_node(node):
                    # Stream tool call and result events
                    async with node.stream(agent_run.ctx) as tool_stream:
                        async for event in tool_stream:
                            if isinstance(event, FunctionToolCallEvent):
                                await _emit(json.dumps({
                                    "type": "tool-use",
                                    "name": event.part.tool_name,
                                    "input": str(event.part.args)[:200],
                                }))
                                storage.append_message(convo_id, {
                                    "role": "tool",
                                    "name": event.part.tool_name,
                                    "input": str(event.part.args)[:200],
                                    "timestamp": _iso_now(),
                                })
                            elif isinstance(event, FunctionToolResultEvent):
                                output = str(event.content)[:500] if event.content else "OK"
                                await _emit(json.dumps({
                                    "type": "tool-result",
                                    "name": event.result.tool_name if hasattr(event.result, "tool_name") else "",
                                    "output": output,
                                }))

            # Compute cost and context info
            turns = len([
                m for m in agent_run.all_messages()
                if isinstance(m, ModelResponse)
            ])
            usage = agent_run.usage()
            cost = usage.total_tokens / 1000 * 0.003
            context_tokens = usage.request_tokens or 0
            context_limit = get_context_limit()

            # Update run state
            run.message_history = agent_run.all_messages()
            run.last_context_tokens = context_tokens

            # Persist agent history
            storage.save_agent_history(
                convo_id,
                ModelMessagesTypeAdapter.dump_json(run.message_history),
            )

            # Persist assistant response
            storage.append_message(convo_id, {
                "role": "assistant",
                "content": run.full_text,
                "timestamp": _iso_now(),
                "cost": cost,
                "turns": turns,
                "context_tokens": context_tokens,
                "context_limit": context_limit,
            })

            done = Done(cost=cost, turns=turns, context_tokens=context_tokens, context_limit=context_limit)
            run.done_event = done.model_dump()
            run.status = "done"
            await _emit(done.model_dump_json())

        storage.update_conversation_status(convo_id, ConvoStatus.done)

    except Exception as e:
        run.error_msg = str(e)
        run.status = "error"
        storage.update_conversation_status(convo_id, ConvoStatus.error)
        await _emit(Error(message=str(e), recoverable=True).model_dump_json())

    finally:
        agent_tools.clear_broadcast()
        # Clean up after a delay to allow reconnecting clients to pick up the result
        await asyncio.sleep(10)
        if active_runs.get(convo_id) is run:
            del active_runs[convo_id]


# ---------------------------------------------------------------------------
# REST API — /api routes
# ---------------------------------------------------------------------------

_bearer = HTTPBearer()


async def _require_token(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> str:
    if not check_token(credentials.credentials):
        raise HTTPException(status_code=401, detail="Invalid token")
    return credentials.credentials


api = APIRouter(prefix="/api", dependencies=[Depends(_require_token)])


# -- Projects ---------------------------------------------------------------

@api.get("/projects", response_model=list[Project])
async def api_list_projects():
    return storage.list_projects()


@api.post("/projects", response_model=Project, status_code=201)
async def api_create_project(body: ProjectCreate):
    return storage.create_project(body)


@api.get("/projects/{project_id}", response_model=Project)
async def api_get_project(project_id: str):
    proj = storage.get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    return proj


@api.put("/projects/{project_id}", response_model=Project)
async def api_update_project(project_id: str, body: ProjectUpdate):
    proj = storage.update_project(project_id, body)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    return proj


@api.delete("/projects/{project_id}", status_code=204)
async def api_delete_project(project_id: str):
    if not storage.delete_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")


# -- Conversations -----------------------------------------------------------

@api.get("/projects/{project_id}/convos", response_model=list[ConvoMeta])
async def api_list_convos(project_id: str):
    proj = storage.get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    return storage.list_conversations(project_id)


@api.post("/projects/{project_id}/convos", response_model=ConvoMeta, status_code=201)
async def api_create_convo(project_id: str, body: ConvoCreate):
    proj = storage.get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    return storage.create_conversation(project_id, body.title)


@api.get("/convos/{convo_id}", response_model=ConvoDetail)
async def api_get_convo(convo_id: str):
    convo = storage.get_conversation(convo_id)
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return convo


@api.delete("/convos/{convo_id}", status_code=204)
async def api_delete_convo(convo_id: str):
    if not storage.delete_conversation(convo_id):
        raise HTTPException(status_code=404, detail="Conversation not found")


app.include_router(api)

# ---------------------------------------------------------------------------
# Static files (chat UI)
# ---------------------------------------------------------------------------

FRONTEND_DIR = Path(__file__).parent.parent / "frontend" / "dist"

# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------


def check_token(input_token: str) -> bool:
    if not WS_TOKEN:
        return False
    return hmac.compare_digest(input_token.encode(), WS_TOKEN.encode())


def _load_access() -> dict[str, list[str]]:
    access_file = DOCS_DIR / ".access.json"
    try:
        return json.loads(access_file.read_text())
    except Exception:
        return {}


def _can_access(slug: str, token: str | None, rules: dict) -> bool:
    if slug not in rules:
        return True
    return token is not None and token in rules[slug]


def _get_token(request: Request) -> str | None:
    t = request.query_params.get("t")
    if t:
        return t
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:]
    return None


# ---------------------------------------------------------------------------
# HTML helpers
# ---------------------------------------------------------------------------


def _escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _layout(title: str, body: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>{_escape(title)}</title>
<style>
  *, *::before, *::after {{ box-sizing: border-box; }}
  :root {{
    --bg: #fff; --fg: #1a1a1a; --fg-muted: #555; --link: #0969da;
    --border: #d0d7de; --code-bg: #f5f5f5; --block-bg: #f8f9fa; --max-w: 46rem;
  }}
  @media (prefers-color-scheme: dark) {{
    :root {{
      --bg: #0d1117; --fg: #c9d1d9; --fg-muted: #8b949e; --link: #58a6ff;
      --border: #30363d; --code-bg: #161b22; --block-bg: #161b22;
    }}
  }}
  body {{
    margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica,
      Arial, sans-serif; font-size: 1rem; line-height: 1.6;
    color: var(--fg); background: var(--bg);
  }}
  .container {{ max-width: var(--max-w); margin: 0 auto; padding: 2rem 1.25rem; }}
  a {{ color: var(--link); text-decoration: none; }}
  a:hover {{ text-decoration: underline; }}
  .file-list {{ list-style: none; padding: 0; }}
  .file-list li {{
    padding: 0.6rem 0; border-bottom: 1px solid var(--border);
    display: flex; justify-content: space-between; align-items: baseline; gap: 1rem;
  }}
  .file-list .meta {{ color: var(--fg-muted); font-size: 0.85rem; white-space: nowrap; }}
  .article h1, .article h2, .article h3 {{ margin-top: 1.8em; margin-bottom: 0.5em; line-height: 1.25; }}
  .article h1 {{ font-size: 1.75rem; }}
  .article h2 {{ font-size: 1.4rem; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }}
  .article img {{ max-width: 100%; height: auto; }}
  .article pre {{ background: var(--code-bg); padding: 1rem; overflow-x: auto; border-radius: 6px; font-size: 0.875rem; }}
  .article code {{ background: var(--code-bg); padding: 0.15em 0.35em; border-radius: 4px; font-size: 0.9em; }}
  .article pre code {{ background: none; padding: 0; border-radius: 0; font-size: inherit; }}
  .article blockquote {{
    margin: 1rem 0; padding: 0.25rem 1rem; border-left: 4px solid var(--border);
    color: var(--fg-muted); background: var(--block-bg); border-radius: 0 6px 6px 0;
  }}
  .article table {{ border-collapse: collapse; width: 100%; overflow-x: auto; display: block; }}
  .article th, .article td {{ border: 1px solid var(--border); padding: 0.45rem 0.75rem; text-align: left; }}
  .article th {{ background: var(--block-bg); }}
  .back {{ display: inline-block; margin-bottom: 1rem; }}
  mjx-container {{ overflow-x: auto; overflow-y: hidden; }}
</style>
<script>
  window.MathJax = {{
    tex: {{ inlineMath: [['$', '$']], displayMath: [['$$', '$$']] }},
    options: {{ skipHtmlTags: ['script','noscript','style','textarea','pre','code'] }},
  }};
</script>
<script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"></script>
<script src="https://hypothes.is/embed.js" async></script>
</head>
<body>
<div class="container">
{body}
</div>
</body>
</html>"""


def _format_date(mtime: float) -> str:
    d = datetime.fromtimestamp(mtime)
    return d.strftime("%b %d, %Y")


# ---------------------------------------------------------------------------
# Doc routes
# ---------------------------------------------------------------------------


def _safe_resolve(base: Path, rel: str) -> Path | None:
    """Resolve a path and ensure it's inside the base directory."""
    try:
        p = (base / rel).resolve()
        base_resolved = base.resolve()
        if str(p).startswith(str(base_resolved) + "/") or p == base_resolved:
            return p
    except Exception:
        pass
    return None


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    rules = _load_access()
    token = _get_token(request)
    docs = []
    if DOCS_DIR.exists():
        for f in sorted(DOCS_DIR.iterdir()):
            if not f.name.endswith(".md"):
                continue
            resolved = _safe_resolve(DOCS_DIR, f.name)
            if not resolved or not resolved.is_file():
                continue
            slug = f.stem
            if not _can_access(slug, token, rules):
                continue
            docs.append((slug, f.name.replace(".md", ""), resolved.stat().st_mtime))

    docs.sort(key=lambda x: x[2], reverse=True)
    items = "\n".join(
        f'<li><a href="/{_escape(slug)}">{_escape(name)}</a> <span class="meta">{_format_date(mt)}</span></li>'
        for slug, name, mt in docs
    )
    body = (
        f'<h1>Documents</h1>\n<ul class="file-list">\n{items}\n</ul>'
        if docs
        else '<h1>Documents</h1>\n<p>No markdown files found in <code>docs/</code>.</p>'
    )
    return HTMLResponse(_layout("Documents", body))


@app.get("/chat/{rest:path}", response_class=HTMLResponse)
@app.get("/chat", response_class=HTMLResponse)
async def chat_page(rest: str = ""):
    if not WS_TOKEN:
        return Response("Chat not configured", status_code=503)
    if not FRONTEND_DIR.exists() or not (FRONTEND_DIR / "index.html").exists():
        return Response("Frontend not built. Run: cd frontend && bun run build", status_code=503)
    # Serve static assets from dist/ (JS, CSS)
    if rest and "." in rest:
        asset = FRONTEND_DIR / rest
        if asset.exists() and asset.is_file():
            suffix = asset.suffix.lower()
            media_types = {".js": "application/javascript", ".css": "text/css", ".map": "application/json"}
            return Response(asset.read_bytes(), media_type=media_types.get(suffix, "application/octet-stream"))
    return HTMLResponse((FRONTEND_DIR / "index.html").read_text())


# Static assets from docs/
ASSET_TYPES = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
    ".pdf": "application/pdf",
}


@app.get("/{path:path}")
async def doc_or_asset(path: str, request: Request):
    if "\0" in path:
        return Response("Not found", status_code=404)

    # Check if it's a static asset
    ext = ""
    if "." in path:
        ext = path[path.rfind("."):].lower()

    if ext in ASSET_TYPES:
        resolved = _safe_resolve(DOCS_DIR, path)
        if resolved and resolved.is_file():
            data = resolved.read_bytes()
            return Response(data, media_type=ASSET_TYPES[ext], headers={"Cache-Control": "public, max-age=3600"})
        return Response("Not found", status_code=404)

    # Document page
    slug = path
    if "/" in slug:
        return Response("Not found", status_code=404)

    rules = _load_access()
    token = _get_token(request)
    if not _can_access(slug, token, rules):
        return Response("Unauthorized", status_code=401)

    resolved = _safe_resolve(DOCS_DIR, f"{slug}.md")
    if not resolved or not resolved.is_file():
        body = '<h1>404</h1><p>File not found.</p><a class="back" href="/">&larr; Back</a>'
        return HTMLResponse(_layout("Not Found", body), status_code=404)

    md_text = resolved.read_text(errors="replace")
    html = markdown.markdown(md_text, extensions=["fenced_code", "tables", "toc"])
    body = f'<a class="back" href="/">&larr; Back</a>\n<article class="article">\n{html}\n</article>'
    return HTMLResponse(_layout(slug, body))


# ---------------------------------------------------------------------------
# WebSocket chat
# ---------------------------------------------------------------------------


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.websocket("/api/ws/{convo_id}")
async def ws_convo_chat(ws: WebSocket, convo_id: str):
    global active_ws

    # Origin check
    origin = ws.headers.get("origin", "")
    if ALLOWED_ORIGIN and origin and origin != ALLOWED_ORIGIN:
        await ws.close(code=4403, reason="Forbidden")
        return

    # If there's an existing connection for this convo, close it
    old_ws = active_ws.get(convo_id)
    if old_ws:
        try:
            await old_ws.close(code=4409, reason="Replaced by new connection")
        except Exception:
            pass

    # Global concurrency limit (different conversations)
    other_convos = {k for k in active_ws if k != convo_id}
    if len(other_convos) >= 1:
        await ws.close(code=4429, reason="Too many connections")
        return

    await ws.accept()
    active_ws[convo_id] = ws
    print(f"ws[{convo_id[:8]}]: connected (active: {len(active_ws)})")

    try:
        # ----- Auth handshake (first-message pattern) -----
        raw = await ws.receive_text()
        try:
            msg = json.loads(raw)
            if msg.get("type") != "auth" or not check_token(msg.get("token", "")):
                raise ValueError("bad auth")
        except Exception:
            print(f"ws[{convo_id[:8]}]: auth failed, closing")
            await ws.send_text(Error(message="Invalid token").model_dump_json())
            await ws.close(code=4401, reason="Invalid token")
            return

        # ----- Validate conversation exists and load project -----
        convo = storage.get_conversation(convo_id)
        if convo is None:
            await ws.send_text(Error(message="Conversation not found").model_dump_json())
            await ws.close(code=4404, reason="Conversation not found")
            return

        project = storage.get_project(convo.project_id)
        if project is None:
            await ws.send_text(Error(message="Project not found").model_dump_json())
            await ws.close(code=4404, reason="Project not found")
            return

        # Scope agent tools to the project's path
        project_path = Path(project.path)
        if not project_path.exists() or not project_path.is_dir():
            await ws.send_text(
                Error(message=f"Project path does not exist: {project.path}").model_dump_json()
            )
            await ws.close(code=4400, reason="Invalid project path")
            return

        await ws.send_text(AuthOk().model_dump_json())
        print(f"ws[{convo_id[:8]}]: authenticated, project={project.name}, path={project.path}")

        # ----- Load existing message history -----
        message_history: list = []
        last_context_tokens = 0

        # Restore PydanticAI agent history if available
        agent_history_bytes = storage.load_agent_history(convo_id)
        if agent_history_bytes:
            try:
                message_history = ModelMessagesTypeAdapter.validate_json(agent_history_bytes)
                # Restore last known context tokens from persisted messages
                persisted_msgs = storage.read_messages(convo_id)
                for msg in reversed(persisted_msgs):
                    if msg.get("role") == "assistant" and "context_tokens" in msg:
                        last_context_tokens = msg["context_tokens"]
                        break
                print(f"ws[{convo_id[:8]}]: restored {len(message_history)} agent messages")
            except Exception as e:
                print(f"ws[{convo_id[:8]}]: failed to restore agent history: {e}")
                message_history = []

        # ----- Check for active run (reconnection scenario) -----
        existing_run = active_runs.get(convo_id)
        if existing_run and existing_run.status == "running":
            # Subscribe to the existing run and replay all buffered events in order
            existing_run.subscribers.add(ws)
            await ws.send_text(Running().model_dump_json())
            for event_str in existing_run.events:
                await ws.send_text(event_str)
            print(f"ws[{convo_id[:8]}]: subscribed to active run ({len(existing_run.events)} events buffered)")
        elif existing_run and existing_run.status in ("done", "error"):
            # Run completed while disconnected — sync state
            message_history = existing_run.message_history
            last_context_tokens = existing_run.last_context_tokens
            if active_runs.get(convo_id) is existing_run:
                del active_runs[convo_id]

        # ----- Chat loop -----
        while True:
            prompt = await ws.receive_text()

            # Sync state from a completed run (if user sends next message after reconnecting)
            completed_run = active_runs.get(convo_id)
            if completed_run and completed_run.task and completed_run.task.done():
                message_history = completed_run.message_history
                last_context_tokens = completed_run.last_context_tokens
                if active_runs.get(convo_id) is completed_run:
                    del active_runs[convo_id]
            elif completed_run and completed_run.status == "running":
                await ws.send_text(
                    Error(message="Agent is still running", recoverable=True).model_dump_json()
                )
                continue

            # Handle /compact command
            if prompt.strip() == "/compact":
                if message_history:
                    old_tokens = last_context_tokens
                    message_history, summary = await compact(message_history)
                    if summary:
                        est_tokens = sum(len(str(m)) for m in message_history) // 4
                        last_context_tokens = est_tokens
                        storage.append_message(convo_id, {
                            "role": "tool",
                            "name": "compact",
                            "input": f"{old_tokens / 1000:.1f}k → {est_tokens / 1000:.1f}k tokens",
                            "timestamp": _iso_now(),
                        })
                        storage.save_agent_history(
                            convo_id,
                            ModelMessagesTypeAdapter.dump_json(message_history),
                        )
                        await ws.send_text(
                            Compacted(old_tokens=old_tokens, new_tokens=est_tokens).model_dump_json()
                        )
                    else:
                        await ws.send_text(
                            Error(message="Not enough history to compact", recoverable=True).model_dump_json()
                        )
                else:
                    await ws.send_text(
                        Error(message="No message history to compact", recoverable=True).model_dump_json()
                    )
                continue

            # Persist the user message
            storage.append_message(convo_id, {
                "role": "user",
                "content": prompt,
                "timestamp": _iso_now(),
            })

            # Mark conversation as running
            storage.update_conversation_status(convo_id, ConvoStatus.running)

            # Auto-compact if over budget
            if message_history and needs_compaction(last_context_tokens):
                old_tokens = last_context_tokens
                message_history, summary = await compact(message_history)
                if summary:
                    est_tokens = sum(len(str(m)) for m in message_history) // 4
                    storage.append_message(convo_id, {
                        "role": "tool",
                        "name": "compact",
                        "input": f"{old_tokens / 1000:.1f}k → {est_tokens / 1000:.1f}k tokens (auto)",
                        "timestamp": _iso_now(),
                    })
                    last_context_tokens = est_tokens
                    storage.save_agent_history(
                        convo_id,
                        ModelMessagesTypeAdapter.dump_json(message_history),
                    )
                    await ws.send_text(
                        Compacted(old_tokens=old_tokens, new_tokens=est_tokens).model_dump_json()
                    )

            # Launch agent run as a background task
            run = RunState(
                convo_id=convo_id,
                message_history=list(message_history),
            )
            run.subscribers.add(ws)
            active_runs[convo_id] = run

            # Set workdir in the current context — create_task copies it
            agent_tools.set_workdir(project_path)
            run.task = asyncio.create_task(_run_agent_task(run, prompt, message_history, convo_id))

            # Wait for the run to complete, but allow WS disconnect to break out
            try:
                await run.task
            except asyncio.CancelledError:
                pass

            # Sync state from completed run
            if run.status == "done":
                message_history = run.message_history
                last_context_tokens = run.last_context_tokens

    except WebSocketDisconnect:
        # Unsubscribe from any active run (task continues in background)
        run = active_runs.get(convo_id)
        if run:
            run.subscribers.discard(ws)
            print(f"ws[{convo_id[:8]}]: disconnected, run continues in background")
    finally:
        # Only remove if we're still the active connection for this convo
        if active_ws.get(convo_id) is ws:
            del active_ws[convo_id]
        print(f"ws[{convo_id[:8]}]: disconnected (active: {len(active_ws)})")
