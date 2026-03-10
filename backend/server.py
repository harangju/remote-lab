"""FastAPI server: WebSocket chat + markdown doc serving."""

from __future__ import annotations

import hmac
import json
import os
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
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    ThinkingPart,
    PartStartEvent,
    PartDeltaEvent,
    TextPartDelta,
    ThinkingPartDelta,
)

from backend.agents import agent, USAGE_LIMITS
from backend.protocol import AuthOk, TextDelta, ThinkingDelta, Done, Error
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

active_ws = 0

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

    # Concurrency limit
    if active_ws >= 1:
        await ws.close(code=4429, reason="Too many connections")
        return

    await ws.accept()
    active_ws += 1
    print(f"ws[{convo_id[:8]}]: connected (active: {active_ws})")

    # Save the original WORKDIR so we can restore it on disconnect
    original_workdir = agent_tools.WORKDIR

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
        if project_path.exists() and project_path.is_dir():
            agent_tools.WORKDIR = project_path
        else:
            await ws.send_text(
                Error(message=f"Project path does not exist: {project.path}").model_dump_json()
            )
            await ws.close(code=4400, reason="Invalid project path")
            return

        await ws.send_text(AuthOk().model_dump_json())
        print(f"ws[{convo_id[:8]}]: authenticated, project={project.name}, path={project.path}")

        # ----- Load existing message history from JSONL -----
        message_history: list = []
        persisted = storage.read_messages(convo_id)
        # Send persisted messages to the client so reconnecting picks up
        # where it left off (client can render them).
        if persisted:
            await ws.send_text(json.dumps({"type": "history", "messages": persisted}))

        # ----- Chat loop -----
        while True:
            prompt = await ws.receive_text()

            # Persist the user message
            storage.append_message(convo_id, {
                "role": "user",
                "content": prompt,
                "timestamp": _iso_now(),
            })

            # Mark conversation as running
            storage.update_conversation_status(convo_id, ConvoStatus.running)

            try:
                agent_tools.set_active_ws(ws)
                async with agent.run_stream(
                    prompt,
                    message_history=message_history if message_history else None,
                    usage_limits=USAGE_LIMITS,
                ) as result:
                    full_text = ""

                    # Stream structured events (thinking, text, tool calls)
                    agent_stream = result._stream_response
                    if agent_stream is not None:
                        async for event in agent_stream:
                            if isinstance(event, PartStartEvent):
                                if isinstance(event.part, ThinkingPart) and event.part.content:
                                    await ws.send_text(ThinkingDelta(delta=event.part.content).model_dump_json())
                                elif isinstance(event.part, TextPart) and event.part.content:
                                    full_text += event.part.content
                                    await ws.send_text(TextDelta(delta=event.part.content).model_dump_json())
                            elif isinstance(event, PartDeltaEvent):
                                if isinstance(event.delta, ThinkingPartDelta):
                                    await ws.send_text(ThinkingDelta(delta=event.delta.content_delta).model_dump_json())
                                elif isinstance(event.delta, TextPartDelta):
                                    full_text += event.delta.content_delta
                                    await ws.send_text(TextDelta(delta=event.delta.content_delta).model_dump_json())
                        await result._marked_completed(result.response)

                    # Get final result for cost/turn info
                    turns = len([
                        m for m in result.all_messages()
                        if isinstance(m, ModelResponse)
                    ])

                    cost = result.usage().total_tokens / 1000 * 0.003

                    # Persist tool calls from message history
                    for msg_item in result.new_messages():
                        if isinstance(msg_item, ModelResponse):
                            for part in msg_item.parts:
                                if isinstance(part, ToolCallPart):
                                    storage.append_message(convo_id, {
                                        "role": "tool",
                                        "name": part.tool_name,
                                        "input": str(part.args)[:200],
                                        "timestamp": _iso_now(),
                                    })

                    # Update message history for next turn
                    message_history = result.all_messages()

                    # Persist the assistant response
                    storage.append_message(convo_id, {
                        "role": "assistant",
                        "content": full_text,
                        "timestamp": _iso_now(),
                        "cost": cost,
                        "turns": turns,
                    })

                    await ws.send_text(
                        Done(cost=cost, turns=turns).model_dump_json()
                    )

                # Mark conversation as done after successful response
                storage.update_conversation_status(convo_id, ConvoStatus.done)

            except Exception as e:
                storage.update_conversation_status(convo_id, ConvoStatus.error)
                await ws.send_text(
                    Error(message=str(e), recoverable=True).model_dump_json()
                )

    except WebSocketDisconnect:
        pass
    finally:
        agent_tools.clear_active_ws()
        agent_tools.WORKDIR = original_workdir
        active_ws -= 1
        print(f"ws[{convo_id[:8]}]: disconnected (active: {active_ws})")
