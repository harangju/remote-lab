"""FastAPI server: WebSocket chat UI, REST API, agent runner."""

from __future__ import annotations

import asyncio
import hmac
import json
import os
from typing import Any
from pathlib import Path
from uuid import uuid4
from types import SimpleNamespace

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import HTMLResponse, Response
import mimetypes
from pydantic_ai.messages import UserContent

from backend.agent.agent_config import AgentConfig
from backend.agent.agents import agent, create_agent, USAGE_LIMITS, get_context_limit
from backend.agent.compact import compact, needs_compaction
from backend.agent.context import build_project_instructions
from backend.agent.mentions import parse_mentions, extract_file_mentions
from backend.data.protocol import AuthOk, MessageAck, TextDelta, ThinkingDelta, Done, Running, AgentStart, Compacted, SkillResult, ToolConfirm, TitleUpdated, VoiceState, VoiceTranscript, Error, FileChanged, ToolResult, ToolOutput
from backend.agent.skills import get_skills, get_skill, SkillType
from backend.agent.permissions import is_tool_auto_allowed, add_project_rule, tool_is_always_confirmed, build_project_rule
from backend.data.models import (
    Project, ProjectCreate, ProjectUpdate,
    ConvoMeta, ConvoCreate, ConvoUpdate, ConvoDetail,
    ConvoStatus, UploadResult,
)
from backend.data import storage
from backend.agent import tools as agent_tools
from backend.voice.stt import DeepgramSTTSession
from backend.api.routes import create_api_router
from backend.runtime.state import ConversationSession, RunState, get_convo_lock, get_session, processed_message_ids, seen_tool_call_ids, sessions
from backend.runtime.commands import handle_share, handle_shares, handle_unshare
from backend.runtime.helpers import append_event, append_message, auto_title, broadcast_conversation_event, build_shared_context, iso_now, parse_tool_content, resolve_project_file, save_agent_history, system_event, tool_event, update_conversation_autonomy, update_conversation_status, update_conversation_title, user_event
from backend.runtime.runner import build_multimodal_prompt, run_agent_task, run_bash_command_task
from backend.runtime.ws import create_ws_handler


def get_workdir() -> Path:
    return agent_tools.get_workdir()


def _new_run_id() -> str:
    return uuid4().hex[:12]


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

# ---------------------------------------------------------------------------
# Run/session state — decouples agent runs from WebSocket lifecycle
# ---------------------------------------------------------------------------




# ---------------------------------------------------------------------------
# REST API — /api routes
# ---------------------------------------------------------------------------

FRONTEND_DIR = Path(__file__).parent.parent / "frontend" / "dist"


def check_token(input_token: str) -> bool:
    if not WS_TOKEN:
        return False
    return hmac.compare_digest(input_token.encode(), WS_TOKEN.encode())


def _resolve_project_file(project_id: str, path: str) -> tuple[Path, Path]:
    proj = storage.get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    project_path = Path(proj.path).resolve()
    if not project_path.exists() or not project_path.is_dir():
        raise HTTPException(status_code=400, detail="Project path does not exist")
    target = (project_path / path).resolve()
    if not str(target).startswith(str(project_path)):
        raise HTTPException(status_code=403, detail="Path traversal not allowed")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return project_path, target


api = create_api_router(check_token=check_token, resolve_project_file=_resolve_project_file)
app.include_router(api)


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


ws_convo_chat = create_ws_handler(
    allowed_origin=ALLOWED_ORIGIN,
    public_base_url=PUBLIC_BASE_URL,
    public_dir=PUBLIC_DIR,
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
    auto_title=lambda convo_id, user_message: auto_title(convo_id, user_message, ["openai:gpt-5-nano", "google-gla:gemini-2.5-flash"]),
    iso_now=iso_now,
    get_workdir=get_workdir,
)
app.websocket("/api/ws/{convo_id}")(ws_convo_chat)
