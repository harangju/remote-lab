"""FastAPI server: SSE stream + REST API for chat, optional voice WebSocket."""

from __future__ import annotations

import asyncio
import hmac
import os
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, Response

from backend.agent.agents import _available
from backend.data import storage
from backend.agent import tools as agent_tools
from backend.api.routes import create_api_router
from backend.runtime.state import sessions
from backend.runtime.helpers import (
    append_event, append_message, auto_title,
    broadcast_conversation_event, build_shared_context, iso_now,
    parse_tool_content, resolve_project_file, save_agent_history,
    system_event, tool_event, update_conversation_status,
    update_conversation_title, user_event,
)
from backend.runtime.sse import create_sse_router
from backend.runtime.voice import create_voice_ws_handler


def get_workdir() -> Path:
    return agent_tools.get_workdir()


app = FastAPI()


@app.on_event("shutdown")
async def _cancel_running_tasks():
    """Cancel in-flight agent tasks so they clean up conversation status via CancelledError handler."""
    for session in list(sessions.values()):
        run = session.run
        if run and run.task and not run.task.done():
            run.task.cancel()
            try:
                await run.task
            except (asyncio.CancelledError, Exception):
                pass


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

WS_TOKEN = os.getenv("WS_TOKEN", "")
ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/")
PUBLIC_DIR = Path(__file__).parent.parent / "public"
FRONTEND_DIR = Path(__file__).parent.parent / "frontend" / "dist"


def check_token(input_token: str) -> bool:
    if not WS_TOKEN:
        return False
    return hmac.compare_digest(input_token.encode(), WS_TOKEN.encode())


def _resolve_project_file(project_id: str, path: str) -> tuple[Path, Path]:
    return resolve_project_file(project_id, path)


# ---------------------------------------------------------------------------
# REST API — /api routes
# ---------------------------------------------------------------------------

api, embed = create_api_router(check_token=check_token, resolve_project_file=_resolve_project_file)
app.include_router(api)
app.include_router(embed)

# ---------------------------------------------------------------------------
# SSE stream + REST chat endpoints
# ---------------------------------------------------------------------------

sse_router = create_sse_router(
    check_token=check_token,
    append_event=append_event,
    append_message=append_message,
    update_conversation_status=update_conversation_status,
    save_agent_history=save_agent_history,
    update_conversation_title=update_conversation_title,
    broadcast_conversation_event=broadcast_conversation_event,
    user_event=user_event,
    tool_event=tool_event,
    system_event=system_event,
    parse_tool_content=parse_tool_content,
    build_shared_context=build_shared_context,
    auto_title=lambda convo_id, user_message: auto_title(convo_id, user_message, _available),
    iso_now=iso_now,
    get_workdir=get_workdir,
)
app.include_router(sse_router)

# ---------------------------------------------------------------------------
# Voice WebSocket (separate, on-demand)
# ---------------------------------------------------------------------------

voice_ws_handler = create_voice_ws_handler(
    check_token=check_token,
    allowed_origin=ALLOWED_ORIGIN,
)
app.websocket("/api/ws/{convo_id}/voice")(voice_ws_handler)

# Legacy WS endpoint removed — all chat traffic now uses SSE + REST.
# Voice uses /api/ws/{convo_id}/voice.

# ---------------------------------------------------------------------------
# Frontend SPA
# ---------------------------------------------------------------------------


@app.get("/{rest:path}", response_class=HTMLResponse)
@app.get("/", response_class=HTMLResponse)
async def chat_page(rest: str = ""):
    if not WS_TOKEN:
        return Response("Chat not configured", status_code=503)
    if not FRONTEND_DIR.exists() or not (FRONTEND_DIR / "index.html").exists():
        return Response("Frontend not built. Run: cd frontend && bun run build", status_code=503)
    if rest and "." in rest:
        asset = FRONTEND_DIR / rest
        if asset.exists() and asset.is_file():
            suffix = asset.suffix.lower()
            media_types = {
                ".js": "application/javascript", ".css": "text/css",
                ".map": "application/json", ".json": "application/json",
                ".png": "image/png", ".svg": "image/svg+xml",
                ".webmanifest": "application/manifest+json",
            }
            ct = media_types.get(suffix, "application/octet-stream")
            headers = {}
            if rest == "sw.js":
                headers["Service-Worker-Allowed"] = "/"
                headers["Cache-Control"] = "no-cache"
            return Response(asset.read_bytes(), media_type=ct, headers=headers)
    return HTMLResponse((FRONTEND_DIR / "index.html").read_text())
