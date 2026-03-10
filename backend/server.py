"""FastAPI server: WebSocket chat + markdown doc serving."""

from __future__ import annotations

import hmac
import json
import os
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

import markdown
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic_ai.messages import (
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
)

from backend.agents import agent, USAGE_LIMITS
from backend.protocol import AuthOk, TextDelta, ToolUse, Done, Error

app = FastAPI()

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DOCS_DIR = Path(__file__).parent.parent / "docs"
WS_TOKEN = os.getenv("WS_TOKEN", "")
ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "")

active_ws = 0

# ---------------------------------------------------------------------------
# Static files (chat UI)
# ---------------------------------------------------------------------------

STATIC_DIR = Path(__file__).parent.parent / "static"
FRONTEND_DIR = Path(__file__).parent.parent / "frontend" / "dist"
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

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
    from datetime import datetime
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
    # Serve built React SPA if available, otherwise fall back to old static chat
    if FRONTEND_DIR.exists() and (FRONTEND_DIR / "index.html").exists():
        # Serve static assets from dist/ (JS, CSS)
        if rest and "." in rest:
            asset = FRONTEND_DIR / rest
            if asset.exists() and asset.is_file():
                suffix = asset.suffix.lower()
                media_types = {".js": "application/javascript", ".css": "text/css", ".map": "application/json"}
                return Response(asset.read_bytes(), media_type=media_types.get(suffix, "application/octet-stream"))
        return HTMLResponse((FRONTEND_DIR / "index.html").read_text())
    html = (STATIC_DIR / "index.html").read_text()
    return HTMLResponse(html)


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


@app.websocket("/ws")
async def ws_chat(ws: WebSocket):
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
    print(f"ws: connected (active: {active_ws})")

    try:
        # Auth handshake
        raw = await ws.receive_text()
        try:
            msg = json.loads(raw)
            if msg.get("type") != "auth" or not check_token(msg.get("token", "")):
                raise ValueError("bad auth")
        except Exception:
            print("ws: auth failed, closing")
            await ws.send_text(Error(message="Invalid token").model_dump_json())
            await ws.close(code=4401, reason="Invalid token")
            return

        await ws.send_text(AuthOk().model_dump_json())
        print("ws: authenticated")

        # Message history for multi-turn conversation
        message_history: list = []

        # Chat loop
        while True:
            prompt = await ws.receive_text()

            try:
                async with agent.run_stream(
                    prompt,
                    message_history=message_history if message_history else None,
                    usage_limits=USAGE_LIMITS,
                ) as result:
                    # Stream text deltas
                    async for text in result.stream_text(delta=True):
                        await ws.send_text(TextDelta(delta=text).model_dump_json())

                    # Get final result for cost/turn info and message history
                    turns = len([
                        m for m in result.all_messages()
                        if isinstance(m, ModelResponse)
                    ])

                    # Send tool use events from the message history
                    for msg in result.new_messages():
                        if isinstance(msg, ModelResponse):
                            for part in msg.parts:
                                if isinstance(part, ToolCallPart):
                                    await ws.send_text(
                                        ToolUse(name=part.tool_name, input=str(part.args)[:200]).model_dump_json()
                                    )

                    # Update message history for next turn
                    message_history = result.all_messages()

                    await ws.send_text(
                        Done(cost=result.usage().total_tokens / 1000 * 0.003, turns=turns).model_dump_json()
                    )

            except Exception as e:
                await ws.send_text(
                    Error(message=str(e), recoverable=True).model_dump_json()
                )

    except WebSocketDisconnect:
        pass
    finally:
        active_ws -= 1
        print(f"ws: disconnected (active: {active_ws})")
