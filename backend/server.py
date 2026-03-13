"""FastAPI server: WebSocket chat UI, REST API, agent runner."""

from __future__ import annotations

import asyncio
import hmac
import json
import os
from dataclasses import dataclass, field
from typing import Any
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic_ai.messages import (
    ModelResponse,
    ModelMessagesTypeAdapter,
    TextPart,
    PartStartEvent,
    PartDeltaEvent,
    TextPartDelta,
    ThinkingPartDelta,
    FunctionToolCallEvent,
    FunctionToolResultEvent,
)

from pydantic_ai.tools import DeferredToolRequests, DeferredToolResults, ToolApproved, ToolDenied

from backend.agent_config import AgentConfig
from backend.agents import agent, create_agent, USAGE_LIMITS, get_context_limit
from backend.compact import compact, needs_compaction
from backend.context import build_project_instructions
from backend.mentions import parse_mentions, extract_file_mentions
from backend.protocol import AuthOk, MessageAck, TextDelta, ThinkingDelta, Done, Running, AgentStart, Compacted, SkillResult, ToolConfirm, TitleUpdated, Error
from backend.skills import get_skills, get_skill, SkillType
from backend.permissions import is_tool_auto_allowed, add_project_rule, tool_is_always_confirmed
from backend.models import (
    Project, ProjectCreate, ProjectUpdate,
    ConvoMeta, ConvoCreate, ConvoUpdate, ConvoDetail,
    ConvoStatus,
)
from backend import storage
from backend import tools as agent_tools


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

# ---------------------------------------------------------------------------
# Run/session state — decouples agent runs from WebSocket lifecycle
# ---------------------------------------------------------------------------


@dataclass
class RunState:
    """Tracks an in-flight agent run independently of WebSocket connections."""
    convo_id: str
    run_id: str
    task: asyncio.Task | None = None
    events: list[str] = field(default_factory=list)
    full_text: str = ""
    done_event: dict | None = None
    error_msg: str | None = None
    status: str = "running"  # running | done | error
    subscribers: set[WebSocket] = field(default_factory=set)
    message_history: list = field(default_factory=list)
    last_context_tokens: int = 0
    pending_approvals: set[str] = field(default_factory=set)
    pending_approval_details: dict[str, dict[str, Any]] = field(default_factory=dict)
    approval_decisions: dict[str, bool] = field(default_factory=dict)
    approval_event: asyncio.Event = field(default_factory=asyncio.Event)

    async def broadcast(self, msg_str: str):
        dead: set[WebSocket] = set()
        for ws in self.subscribers:
            try:
                await ws.send_text(msg_str)
            except Exception:
                dead.add(ws)
        self.subscribers -= dead


@dataclass
class ConversationSession:
    convo_id: str
    controller: WebSocket | None = None
    subscribers: set[WebSocket] = field(default_factory=set)
    run: RunState | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


sessions: dict[str, ConversationSession] = {}
processed_message_ids: dict[str, set[str]] = {}
convo_locks: dict[str, asyncio.Lock] = {}


def _get_session(convo_id: str) -> ConversationSession:
    session = sessions.get(convo_id)
    if session is None:
        session = ConversationSession(convo_id=convo_id)
        sessions[convo_id] = session
    return session


def _get_convo_lock(convo_id: str) -> asyncio.Lock:
    lock = convo_locks.get(convo_id)
    if lock is None:
        lock = asyncio.Lock()
        convo_locks[convo_id] = lock
    return lock


async def _append_message(convo_id: str, event: dict) -> None:
    async with _get_convo_lock(convo_id):
        storage.append_message(convo_id, event)


async def _update_conversation_status(convo_id: str, status: ConvoStatus) -> None:
    async with _get_convo_lock(convo_id):
        storage.update_conversation_status(convo_id, status)


async def _save_agent_history(convo_id: str, data: bytes, agent_id: str | None = None) -> None:
    async with _get_convo_lock(convo_id):
        storage.save_agent_history(convo_id, data, agent_id=agent_id)


async def _update_conversation_autonomy(convo_id: str, enabled: bool) -> None:
    async with _get_convo_lock(convo_id):
        storage.update_conversation_autonomy(convo_id, enabled)


async def _update_conversation_title(convo_id: str, title: str) -> None:
    async with _get_convo_lock(convo_id):
        storage.update_conversation_title(convo_id, title)


async def _auto_title(convo_id: str, user_message: str, run: RunState):
    from pydantic_ai import Agent as _Agent
    from backend.agents import _available

    title_model = None
    for preferred in ("openai:gpt-5-nano", "google-gla:gemini-2.5-flash"):
        if preferred in _available:
            title_model = preferred
            break
    if not title_model:
        title_model = _available[0]

    try:
        title_agent = _Agent(title_model)
        result = await title_agent.run(
            f"Generate a short title (max 6 words, no quotes) for a conversation that starts with this message:\n\n{user_message[:500]}",
        )
        title = str(result.output).strip().strip('"\'')
        if title:
            await _update_conversation_title(convo_id, title)
            event = TitleUpdated(title=title).model_dump_json()
            run.events.append(event)
            await run.broadcast(event)
    except Exception as e:
        import logging
        logging.getLogger("remote-lab").warning("Auto-title failed: %s", e, exc_info=True)


def _build_shared_context(convo_id: str, agent_id: str | None, max_messages: int = 50, cached_messages: list[dict] | None = None) -> str:
    messages = cached_messages if cached_messages is not None else storage.read_messages(convo_id)
    if not messages:
        return ""

    recent = messages[-max_messages:]
    lines: list[str] = []
    for msg in recent:
        role = msg.get("role", "")
        if role == "user":
            lines.append(f"User: {msg.get('content', '')}")
        elif role == "assistant":
            content = msg.get("content", "")
            if not content:
                continue
            aid = msg.get("agent_id")
            if aid and aid != agent_id:
                lines.append(f"[@{aid}]: {content}")
            elif aid == agent_id:
                lines.append(f"You (earlier): {content}")
            else:
                lines.append(f"Assistant: {content}")
        elif role == "tool":
            aid = msg.get("agent_id")
            name = msg.get("name", "")
            inp = msg.get("input", "")
            if aid and aid != agent_id:
                lines.append(f"[@{aid} used {name}]: {inp}")

    if not lines:
        return ""
    return "\n".join(lines)


async def _run_agent_task(
    run: RunState, prompt: str, message_history: list, convo_id: str,
    instructions: str | None = None,
    agent_instance: "Agent | None" = None,
    agent_id: str | None = None,
):
    active_agent = agent_instance or agent

    async def _emit(msg_str: str):
        run.events.append(msg_str)
        await run.broadcast(msg_str)

    agent_tools.set_broadcast(None)

    try:
        current_prompt: str | None = prompt
        current_history = message_history if message_history else None
        deferred_results: DeferredToolResults | None = None
        total_turns = 0

        while True:
            iter_kwargs: dict = dict(
                message_history=current_history,
                usage_limits=USAGE_LIMITS,
                instructions=instructions,
            )
            if deferred_results:
                iter_kwargs["deferred_tool_results"] = deferred_results
                deferred_results = None

            async with active_agent.iter(current_prompt, **iter_kwargs) as agent_run:
                async for node in agent_run:
                    if active_agent.is_model_request_node(node):
                        segment_text = ""
                        async with node.stream(agent_run.ctx) as stream:
                            async for event in stream:
                                if isinstance(event, PartStartEvent) and isinstance(event.part, TextPart) and event.part.content:
                                    segment_text += event.part.content
                                    run.full_text += event.part.content
                                    await _emit(TextDelta(delta=event.part.content, run_id=run.run_id, agent_id=agent_id).model_dump_json())
                                elif isinstance(event, PartDeltaEvent):
                                    if isinstance(event.delta, TextPartDelta) and event.delta.content_delta:
                                        segment_text += event.delta.content_delta
                                        run.full_text += event.delta.content_delta
                                        await _emit(TextDelta(delta=event.delta.content_delta, run_id=run.run_id, agent_id=agent_id).model_dump_json())
                                    elif isinstance(event.delta, ThinkingPartDelta):
                                        await _emit(ThinkingDelta(delta=event.delta.content_delta or "", run_id=run.run_id, agent_id=agent_id).model_dump_json())
                        if segment_text:
                            msg: dict = {
                                "role": "assistant",
                                "content": segment_text,
                                "timestamp": _iso_now(),
                                "run_id": run.run_id,
                            }
                            if agent_id:
                                msg["agent_id"] = agent_id
                            await _append_message(convo_id, msg)
                    elif active_agent.is_call_tools_node(node):
                        async with node.stream(agent_run.ctx) as tool_stream:
                            async for event in tool_stream:
                                if isinstance(event, FunctionToolCallEvent):
                                    ev = {
                                        "type": "tool-use",
                                        "name": event.part.tool_name,
                                        "input": str(event.part.args)[:200],
                                        "run_id": run.run_id,
                                    }
                                    if agent_id:
                                        ev["agent_id"] = agent_id
                                    await _emit(json.dumps(ev))
                                    persisted = {
                                        "role": "tool",
                                        "name": event.part.tool_name,
                                        "input": str(event.part.args)[:200],
                                        "timestamp": _iso_now(),
                                        "run_id": run.run_id,
                                    }
                                    if agent_id:
                                        persisted["agent_id"] = agent_id
                                    await _append_message(convo_id, persisted)
                                elif isinstance(event, FunctionToolResultEvent):
                                    output = str(event.content)[:500] if event.content else "OK"
                                    ev = {
                                        "type": "tool-result",
                                        "name": event.result.tool_name if hasattr(event.result, "tool_name") else "",
                                        "output": output,
                                        "run_id": run.run_id,
                                    }
                                    if agent_id:
                                        ev["agent_id"] = agent_id
                                    await _emit(json.dumps(ev))

                usage = agent_run.usage()
                total_turns += len([m for m in agent_run.all_messages() if isinstance(m, ModelResponse)])

                result = agent_run.result
                if result and isinstance(result.output, DeferredToolRequests) and result.output.approvals:
                    approvals_needed = result.output.approvals
                    run.pending_approvals = set()
                    run.pending_approval_details = {}
                    run.approval_decisions = {}
                    run.approval_event = asyncio.Event()

                    convo_meta = storage._read_meta(convo_id)
                    convo_autonomous = bool(convo_meta.autonomous_tools_enabled) if convo_meta else False
                    for tool_call in approvals_needed:
                        if is_tool_auto_allowed(get_workdir(), convo_autonomous, tool_call.tool_name, tool_call.args):
                            run.approval_decisions[tool_call.tool_call_id] = True
                            continue
                        run.pending_approvals.add(tool_call.tool_call_id)
                        run.pending_approval_details[tool_call.tool_call_id] = {
                            "name": tool_call.tool_name,
                            "args": tool_call.args,
                        }
                        always_confirm = tool_is_always_confirmed(tool_call.tool_name, tool_call.args)
                        await _emit(ToolConfirm(
                            tool_call_id=tool_call.tool_call_id,
                            name=tool_call.tool_name,
                            run_id=run.run_id,
                            args=str(tool_call.args)[:500] if tool_call.args else None,
                            agent_id=agent_id,
                            can_allow_project=not always_confirm,
                        ).model_dump_json())

                    if run.pending_approvals:
                        await run.approval_event.wait()

                    approval_map: dict = {}
                    for tc_id, approved in run.approval_decisions.items():
                        approval_map[tc_id] = ToolApproved() if approved else ToolDenied(message="User denied this tool call")

                    deferred_results = DeferredToolResults(approvals=approval_map)
                    current_history = agent_run.all_messages()
                    current_prompt = None
                    continue

                break

        context_tokens = usage.request_tokens or 0
        context_limit = get_context_limit()
        run.message_history = agent_run.all_messages()
        run.last_context_tokens = context_tokens

        await _save_agent_history(
            convo_id,
            ModelMessagesTypeAdapter.dump_json(run.message_history),
            agent_id=agent_id,
        )

        meta_msg = {
            "role": "assistant",
            "content": "",
            "timestamp": _iso_now(),
            "turns": total_turns,
            "context_tokens": context_tokens,
            "context_limit": context_limit,
            "run_id": run.run_id,
        }
        if agent_id:
            meta_msg["agent_id"] = agent_id
        await _append_message(convo_id, meta_msg)

        done = Done(turns=total_turns, run_id=run.run_id, context_tokens=context_tokens, context_limit=context_limit, agent_id=agent_id)
        run.done_event = done.model_dump()
        run.status = "done"
        await _emit(done.model_dump_json())
        await _update_conversation_status(convo_id, ConvoStatus.done)

        meta = storage._read_meta(convo_id)
        if meta and meta.title == "Untitled":
            asyncio.create_task(_auto_title(convo_id, prompt, run))

    except asyncio.CancelledError:
        run.status = "error"
        await _update_conversation_status(convo_id, ConvoStatus.idle)
        await _emit(Error(message="Run stopped", run_id=run.run_id, recoverable=True).model_dump_json())
        raise
    except Exception as e:
        run.error_msg = str(e)
        run.status = "error"
        await _update_conversation_status(convo_id, ConvoStatus.error)
        await _emit(Error(message=str(e), run_id=run.run_id, recoverable=True).model_dump_json())
    finally:
        agent_tools.clear_broadcast()
        await asyncio.sleep(10)
        session = sessions.get(convo_id)
        if session and session.run is run:
            session.run = None
            if not session.subscribers and session.controller is None:
                sessions.pop(convo_id, None)


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


@api.get("/projects", response_model=list[Project])
async def api_list_projects():
    return storage.list_projects()


@api.post("/projects", response_model=Project, status_code=201)
async def api_create_project(body: ProjectCreate):
    if body.github_url:
        target = Path(body.path)
        if target.exists() and any(target.iterdir()):
            raise HTTPException(status_code=400, detail="Target directory already exists and is not empty")
        clone_url = body.github_url
        import re as _re
        m = _re.match(r"https?://github\.com/(.+)", clone_url)
        if m:
            clone_url = f"git@github.com:{m.group(1)}"
            if not clone_url.endswith(".git"):
                clone_url += ".git"
        proc = await asyncio.create_subprocess_exec(
            "git", "clone", "--depth", "1", clone_url, str(target),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=dict(os.environ),
        )
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise HTTPException(status_code=400, detail=f"git clone failed: {stderr.decode().strip()}")
    return storage.create_project(body)


@api.get("/projects/{project_id}", response_model=Project)
async def api_get_project(project_id: str):
    proj = storage.get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    return proj


@api.put("/projects/{project_id}", response_model=Project)
async def api_update_project(project_id: str, body: ProjectUpdate, request: Request):
    payload = await request.json()
    if not payload:
        raise HTTPException(status_code=400, detail="No fields to update")
    proj = storage.update_project(project_id, body)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    return proj


@api.delete("/projects/{project_id}", status_code=204)
async def api_delete_project(project_id: str):
    if not storage.delete_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")


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


@api.patch("/convos/{convo_id}", response_model=ConvoMeta)
async def api_update_convo(convo_id: str, body: ConvoUpdate, request: Request):
    meta = storage._read_meta(convo_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Conversation not found")
    payload = await request.json()
    if not payload:
        raise HTTPException(status_code=400, detail="No fields to update")
    if "title" in payload:
        meta = storage.update_conversation_title(convo_id, body.title or "Untitled")
    if "archived_at" in payload:
        meta = storage.update_conversation_archive(convo_id, body.archived_at)
    if "autonomous_tools_enabled" in payload:
        meta = storage.update_conversation_autonomy(convo_id, bool(body.autonomous_tools_enabled))
    if not meta:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return meta


@api.delete("/convos/{convo_id}", status_code=204)
async def api_delete_convo(convo_id: str):
    if not storage.delete_conversation(convo_id):
        raise HTTPException(status_code=404, detail="Conversation not found")


@api.get("/models")
async def api_list_models():
    from backend.agents import _available, active_model
    return {"models": _available, "active": active_model}


@api.get("/agents")
async def api_list_global_agents():
    return [a.model_dump() for a in storage.load_global_agents()]


@api.put("/agents")
async def api_save_global_agents(body: list[AgentConfig]):
    storage.save_global_agents(body)
    return [a.model_dump() for a in body]


@api.get("/projects/{project_id}/agents")
async def api_list_agents(project_id: str):
    proj = storage.get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    agents = storage.load_project_agents(project_id)
    return {
        "agents": [a.model_dump() for a in agents],
        "custom": storage.has_project_agents(project_id),
    }


@api.put("/projects/{project_id}/agents")
async def api_save_agents(project_id: str, body: list[AgentConfig]):
    proj = storage.get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    storage.save_project_agents(project_id, body)
    return [a.model_dump() for a in body]


@api.delete("/projects/{project_id}/agents")
async def api_delete_project_agents(project_id: str):
    proj = storage.get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    storage.delete_project_agents(project_id)
    return {"ok": True}


@api.get("/projects/{project_id}/skills")
async def api_list_skills(project_id: str):
    proj = storage.get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    project_path = Path(proj.path)
    skills = get_skills(project_path if project_path.is_dir() else None)
    return [s.model_dump() for s in skills]


@api.get("/projects/{project_id}/file")
async def api_read_file(project_id: str, path: str):
    proj = storage.get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    project_path = Path(proj.path)
    if not project_path.exists() or not project_path.is_dir():
        raise HTTPException(status_code=400, detail="Project path does not exist")
    target = (project_path / path).resolve()
    if not str(target).startswith(str(project_path.resolve())):
        raise HTTPException(status_code=403, detail="Path traversal not allowed")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    try:
        content = target.read_text(errors="replace")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    if len(content) > 200_000:
        content = content[:200_000] + "\n\n--- truncated at 200KB ---"
    return {"path": path, "content": content}


from pydantic import BaseModel as _BaseModel


class FileWrite(_BaseModel):
    path: str
    content: str


@api.post("/projects/{project_id}/file")
async def api_write_file(project_id: str, body: FileWrite):
    proj = storage.get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    project_path = Path(proj.path)
    if not project_path.exists() or not project_path.is_dir():
        raise HTTPException(status_code=400, detail="Project path does not exist")
    target = (project_path / body.path).resolve()
    if not str(target).startswith(str(project_path.resolve())):
        raise HTTPException(status_code=403, detail="Path traversal not allowed")
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(body.content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"path": body.path, "size": len(body.content.encode())}


_EXCLUDED_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", ".next", "dist", "build", ".cache", ".mypy_cache", ".ruff_cache"}


@api.get("/projects/{project_id}/files")
async def api_list_files(project_id: str):
    proj = storage.get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    project_path = Path(proj.path).resolve()
    if not project_path.exists() or not project_path.is_dir():
        raise HTTPException(status_code=400, detail="Project path does not exist")
    files: list[str] = []
    for root, dirs, filenames in os.walk(project_path):
        dirs[:] = [d for d in dirs if d not in _EXCLUDED_DIRS and not d.startswith(".")]
        for f in sorted(filenames):
            if f.startswith("."):
                continue
            rel = os.path.relpath(os.path.join(root, f), project_path)
            files.append(rel)
            if len(files) >= 5000:
                break
        if len(files) >= 5000:
            break
    return {"root": proj.path, "files": sorted(files)}


app.include_router(api)

FRONTEND_DIR = Path(__file__).parent.parent / "frontend" / "dist"


def check_token(input_token: str) -> bool:
    if not WS_TOKEN:
        return False
    return hmac.compare_digest(input_token.encode(), WS_TOKEN.encode())


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


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.websocket("/api/ws/{convo_id}")
async def ws_convo_chat(ws: WebSocket, convo_id: str):
    origin = ws.headers.get("origin", "")
    if ALLOWED_ORIGIN and origin and origin != ALLOWED_ORIGIN:
        await ws.close(code=4403, reason="Forbidden")
        return

    await ws.accept()
    session = _get_session(convo_id)
    session.subscribers.add(ws)
    print(f"ws[{convo_id[:8]}]: connected (subscribers: {len(session.subscribers)})")

    try:
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

        project_path = Path(project.path)
        if not project_path.exists() or not project_path.is_dir():
            await ws.send_text(Error(message=f"Project path does not exist: {project.path}").model_dump_json())
            await ws.close(code=4400, reason="Invalid project path")
            return

        await ws.send_text(AuthOk().model_dump_json())
        print(f"ws[{convo_id[:8]}]: authenticated, project={project.name}, path={project.path}")

        project_agents = storage.load_project_agents(project.id)
        _agent_cache: dict[str | None, "Agent"] = {}
        _UNSET = object()
        _cached_instructions: str | None | object = _UNSET
        _cached_instructions_subsequent: str | None = None
        agent_histories: dict[str | None, tuple[list, int]] = {}
        _cached_messages: list[dict] | None = None

        def _get_cached_messages() -> list[dict]:
            nonlocal _cached_messages
            if _cached_messages is None:
                _cached_messages = storage.read_messages(convo_id)
            return _cached_messages

        def _invalidate_message_cache():
            nonlocal _cached_messages
            _cached_messages = None

        def _load_history(aid: str | None) -> tuple[list, int]:
            if aid in agent_histories:
                return agent_histories[aid]
            hist: list = []
            ctx_tokens = 0
            hist_bytes = storage.load_agent_history(convo_id, agent_id=aid)
            if hist_bytes:
                try:
                    hist = ModelMessagesTypeAdapter.validate_json(hist_bytes)
                    for msg in reversed(_get_cached_messages()):
                        if msg.get("role") == "assistant" and "context_tokens" in msg:
                            if aid is None or msg.get("agent_id") == aid:
                                ctx_tokens = msg["context_tokens"]
                                break
                    print(f"ws[{convo_id[:8]}]: restored {len(hist)} messages for agent={aid or 'default'}")
                except Exception as e:
                    print(f"ws[{convo_id[:8]}]: failed to restore history for agent={aid}: {e}")
                    hist = []
            agent_histories[aid] = (hist, ctx_tokens)
            return hist, ctx_tokens

        _load_history(None)

        existing_run = session.run
        if existing_run and existing_run.status == "running":
            existing_run.subscribers.add(ws)
            # Promote to controller if old controller is gone
            if session.controller is None or session.controller not in session.subscribers:
                session.controller = ws
                print(f"ws[{convo_id[:8]}]: promoted to controller (previous controller disconnected)")
            await ws.send_text(Running(run_id=existing_run.run_id).model_dump_json())
            for event_str in existing_run.events:
                await ws.send_text(event_str)
            print(f"ws[{convo_id[:8]}]: subscribed to active run {existing_run.run_id} ({len(existing_run.events)} events buffered)")

        while True:
            raw_message = await ws.receive_text()
            prompt = raw_message
            message_id: str | None = None

            try:
                ctrl = json.loads(raw_message)
                if isinstance(ctrl, dict):
                    if ctrl.get("type") == "stop":
                        run_id = str(ctrl.get("run_id", ""))
                        run = session.run
                        if ws is session.controller and run and run.status == "running" and run.run_id == run_id:
                            if run.task and not run.task.done():
                                run.task.cancel()
                        continue
                    if ctrl.get("type") == "tool-confirm-response":
                        tc_id = str(ctrl.get("tool_call_id", ""))
                        run_id = str(ctrl.get("run_id", ""))
                        approved = bool(ctrl.get("approved", False))
                        scope = ctrl.get("scope", "once")
                        run = session.run
                        if ws is session.controller and run and run.status == "running" and run.run_id == run_id and tc_id in run.pending_approvals:
                            details = run.pending_approval_details.get(tc_id, {})
                            if approved and scope == "project":
                                tool_name = details.get("name")
                                tool_args = details.get("args")
                                if tool_name:
                                    add_project_rule(project_path, tool_name, tool_args)
                            run.approval_decisions[tc_id] = approved
                            run.pending_approvals.discard(tc_id)
                            run.pending_approval_details.pop(tc_id, None)
                            if not run.pending_approvals:
                                run.approval_event.set()
                        continue
                    if ctrl.get("type") == "user-message":
                        prompt = str(ctrl.get("text", "")).strip()
                        message_id = str(ctrl.get("message_id", "")).strip() or None
                        if not prompt:
                            await ws.send_text(Error(message="Empty message", recoverable=True).model_dump_json())
                            continue
                        seen_ids = processed_message_ids.setdefault(convo_id, set())
                        if message_id and message_id in seen_ids:
                            await ws.send_text(MessageAck(message_id=message_id).model_dump_json())
                            continue
            except (json.JSONDecodeError, TypeError):
                pass

            completed_run = session.run
            if completed_run and completed_run.task and completed_run.task.done():
                agent_histories[None] = (completed_run.message_history, completed_run.last_context_tokens)
                session.run = None
                completed_run = None
            elif completed_run and completed_run.status == "running":
                await ws.send_text(Error(message="Agent is still running", run_id=completed_run.run_id, recoverable=True).model_dump_json())
                continue

            async with session.lock:
                if session.controller not in (None, ws):
                    await ws.send_text(Error(message="Conversation is controlled by another client", recoverable=True).model_dump_json())
                    continue
                session.controller = ws

            if prompt.strip().startswith("/"):
                parts = prompt.strip().split(None, 1)
                cmd_name = parts[0][1:]
                cmd_args = parts[1] if len(parts) > 1 else ""
                skill = get_skill(cmd_name, project_path)

                if skill and skill.type == SkillType.server:
                    if skill.name == "compact":
                        for p in storage.CONVOS_DIR.glob(f"{convo_id}.agent*.json"):
                            parts = p.stem.replace(f"{convo_id}.agent", "")
                            aid = parts.lstrip(".") or None
                            _load_history(aid)

                        aids_to_compact = [aid for aid, (h, _) in agent_histories.items() if h]
                        if not aids_to_compact:
                            await ws.send_text(Error(message="No message history to compact", recoverable=True).model_dump_json())
                        else:
                            compacted_any = False
                            for aid in aids_to_compact:
                                hist, ctx_tokens = agent_histories[aid]
                                old_tokens = ctx_tokens
                                hist, summary = await compact(hist)
                                if summary:
                                    compacted_any = True
                                    est_tokens = sum(len(str(m)) for m in hist) // 4
                                    agent_histories[aid] = (hist, est_tokens)
                                    label = f"@{aid} " if aid else ""
                                    await _append_message(convo_id, {
                                        "role": "tool",
                                        "name": "compact",
                                        "input": f"{label}{old_tokens / 1000:.1f}k → {est_tokens / 1000:.1f}k tokens",
                                        "timestamp": _iso_now(),
                                    })
                                    await _save_agent_history(convo_id, ModelMessagesTypeAdapter.dump_json(hist), agent_id=aid)
                                    await ws.send_text(Compacted(old_tokens=old_tokens, new_tokens=est_tokens).model_dump_json())
                            if not compacted_any:
                                await ws.send_text(Error(message="Not enough history to compact", recoverable=True).model_dump_json())
                    elif skill.name == "model":
                        from backend.agents import active_model, _available, set_model
                        if cmd_args.strip():
                            try:
                                new_model = set_model(cmd_args.strip())
                                _agent_cache.clear()
                                output = f"Switched to {new_model}"
                            except ValueError as e:
                                output = str(e)
                        else:
                            output = f"Model: {active_model}"
                            others = [m for m in _available if m != active_model]
                            if others:
                                output += "\nAvailable: " + ", ".join(others)
                                def _short(m: str) -> str:
                                    name = m.split(":")[-1]
                                    if name.startswith("claude-"):
                                        name = name[len("claude-"):]
                                    return name
                                output += "\nSwitch: " + ", ".join(f"/model {_short(m)}" for m in others)
                        await _append_message(convo_id, {
                            "role": "tool",
                            "name": "model",
                            "input": output,
                            "timestamp": _iso_now(),
                        })
                        await ws.send_text(SkillResult(skill="model", output=output).model_dump_json())
                    continue
                elif skill and skill.type == SkillType.prompt:
                    user_text = cmd_args.strip()
                    prompt = f"{skill.prompt}\n\n{user_text}" if user_text else skill.prompt

            _invalidate_message_cache()
            await _append_message(convo_id, {
                "role": "user",
                "content": prompt,
                "timestamp": _iso_now(),
                **({"message_id": message_id} if message_id else {}),
            })
            if message_id:
                processed_message_ids.setdefault(convo_id, set()).add(message_id)
                await ws.send_text(MessageAck(message_id=message_id).model_dump_json())

            await _update_conversation_status(convo_id, ConvoStatus.running)

            if project_agents:
                target_agents, cleaned_prompt = parse_mentions(prompt, project_agents)
            else:
                target_agents = [None]
                cleaned_prompt = prompt

            file_refs, cleaned_prompt = extract_file_mentions(cleaned_prompt, project_path)
            if file_refs:
                file_context = "\n\n".join(f"[File: {path}]\n```\n{content}\n```" for path, content in file_refs)
                cleaned_prompt = f"{file_context}\n\n{cleaned_prompt}"

            run = RunState(convo_id=convo_id, run_id=_new_run_id())
            run.subscribers.update(session.subscribers)
            session.run = run
            await ws.send_text(Running(run_id=run.run_id).model_dump_json())

            agent_tools.set_workdir(project_path)
            if _cached_instructions is _UNSET:
                _cached_instructions = await asyncio.to_thread(build_project_instructions, project_path, True)
                _cached_instructions_subsequent = await asyncio.to_thread(build_project_instructions, project_path, False)

            MAX_HANDOFFS = 10
            handoff_count = 0
            current_targets = target_agents
            current_prompt = cleaned_prompt
            is_handoff = False
            run_context = run

            while current_targets and handoff_count <= MAX_HANDOFFS:
                _invalidate_message_cache()
                runs: list[RunState] = []
                for ac in current_targets:
                    aid = ac.id if ac else None
                    hist, ctx_tokens = _load_history(aid)

                    if hist and needs_compaction(ctx_tokens):
                        old_tokens = ctx_tokens
                        hist, summary = await compact(hist)
                        if summary:
                            est_tokens = sum(len(str(m)) for m in hist) // 4
                            agent_histories[aid] = (hist, est_tokens)
                            await _append_message(convo_id, {
                                "role": "tool",
                                "name": "compact",
                                "input": f"{old_tokens / 1000:.1f}k → {est_tokens / 1000:.1f}k tokens (auto)",
                                "timestamp": _iso_now(),
                                "run_id": run_context.run_id,
                            })
                            await _save_agent_history(convo_id, ModelMessagesTypeAdapter.dump_json(hist), agent_id=aid)
                            await ws.send_text(Compacted(old_tokens=old_tokens, new_tokens=est_tokens).model_dump_json())

                    is_first_turn = len(hist) == 0
                    instructions = _cached_instructions if is_first_turn else _cached_instructions_subsequent
                    agent_prompt = current_prompt
                    if ac:
                        _invalidate_message_cache()
                        shared_ctx = _build_shared_context(convo_id, aid, cached_messages=_get_cached_messages())
                        if shared_ctx:
                            if is_handoff:
                                agent_prompt = f"[Conversation context]\n{shared_ctx}\n\n[Handoff from another agent]\n{current_prompt}"
                            else:
                                agent_prompt = f"[Conversation context]\n{shared_ctx}\n\n[New message from user]\n{current_prompt}"
                        await ws.send_text(AgentStart(run_id=run_context.run_id, agent_id=ac.id, agent_name=ac.name, agent_color=ac.color).model_dump_json())

                    agent_instance = _agent_cache.get(ac.id if ac else None) or create_agent(ac)
                    _agent_cache[ac.id if ac else None] = agent_instance

                    agent_run = RunState(convo_id=convo_id, run_id=run_context.run_id, message_history=list(hist))
                    agent_run.subscribers.update(session.subscribers)
                    session.run = agent_run
                    agent_run.task = asyncio.create_task(
                        _run_agent_task(
                            agent_run, agent_prompt, hist, convo_id,
                            instructions=instructions,
                            agent_instance=agent_instance,
                            agent_id=aid,
                        )
                    )
                    runs.append(agent_run)

                agent_tasks = {r.task for r in runs if r.task}
                try:
                    if agent_tasks:
                        await asyncio.gather(*agent_tasks)
                except asyncio.CancelledError:
                    for r in runs:
                        if r.task and not r.task.done():
                            r.task.cancel()
                    raise

                next_targets: list[AgentConfig] = []
                next_prompt_parts: list[str] = []
                for r in runs:
                    if r.status == "done":
                        aid = r.done_event.get("agent_id") if r.done_event else None
                        agent_histories[aid] = (r.message_history, r.last_context_tokens)
                        if r.full_text and project_agents:
                            mentioned, remaining_text = parse_mentions(r.full_text, project_agents)
                            explicit_mentions = [a for a in mentioned if f"@{a.id}" in r.full_text.lower() or f"@{a.name.lower()}" in r.full_text.lower()]
                            if explicit_mentions:
                                for a in explicit_mentions:
                                    if a.id not in {t.id for t in next_targets}:
                                        next_targets.append(a)
                                next_prompt_parts.append(remaining_text)

                if next_targets and handoff_count < MAX_HANDOFFS:
                    handoff_count += 1
                    current_targets = next_targets
                    current_prompt = "\n".join(next_prompt_parts) if next_prompt_parts else "Continue."
                    is_handoff = True
                    _invalidate_message_cache()
                    print(f"ws[{convo_id[:8]}]: agent handoff #{handoff_count} → {[a.id for a in next_targets]}")
                else:
                    break

            if session.run and session.run.run_id == run.run_id and session.run.status != "running":
                session.controller = None

    except WebSocketDisconnect:
        run = session.run
        if run:
            run.subscribers.discard(ws)
            print(f"ws[{convo_id[:8]}]: disconnected, run continues in background")
    finally:
        session.subscribers.discard(ws)
        if session.controller is ws:
            session.controller = None
        run = session.run
        if run:
            run.subscribers.discard(ws)
        if not session.subscribers and session.controller is None and session.run is None:
            sessions.pop(convo_id, None)
        print(f"ws[{convo_id[:8]}]: disconnected (subscribers: {len(session.subscribers)})")
