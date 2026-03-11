"""FastAPI server: WebSocket chat UI, REST API, agent runner."""

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

from backend.agent_config import AgentConfig
from backend.agents import agent, create_agent, USAGE_LIMITS, get_context_limit
from backend.compact import compact, needs_compaction
from backend.context import build_project_instructions
from backend.mentions import parse_mentions, extract_file_mentions
from backend.protocol import AuthOk, TextDelta, ThinkingDelta, Done, Running, AgentStart, Compacted, Error
from backend.models import (
    Project, ProjectCreate, ProjectUpdate,
    ConvoMeta, ConvoCreate, ConvoUpdate, ConvoDetail,
    ConvoStatus,
)
from backend import storage
from backend import tools as agent_tools

app = FastAPI()

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

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


def _build_shared_context(convo_id: str, agent_id: str | None, max_messages: int = 50, cached_messages: list[dict] | None = None) -> str:
    """Build a summary of recent conversation for cross-agent context.

    Reads the shared JSONL display log and formats messages from other agents
    and the user so this agent knows what's been discussed.
    """
    messages = cached_messages if cached_messages is not None else storage.read_messages(convo_id)
    if not messages:
        return ""

    # Take the most recent messages
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
    """Execute an agent run in the background, broadcasting to subscribers."""
    active_agent = agent_instance or agent

    async def _emit(msg_str: str):
        """Buffer an event and broadcast to subscribers."""
        run.events.append(msg_str)
        await run.broadcast(msg_str)

    # Disable the per-tool broadcast — we get events from agent.iter() instead
    agent_tools.set_broadcast(None)

    try:
        async with active_agent.iter(
            prompt,
            message_history=message_history if message_history else None,
            usage_limits=USAGE_LIMITS,
            instructions=instructions,
        ) as agent_run:
            async for node in agent_run:
                if active_agent.is_model_request_node(node):
                    # Stream text deltas from the model response
                    segment_text = ""
                    async with node.stream(agent_run.ctx) as stream:
                        async for event in stream:
                            if isinstance(event, PartStartEvent) and isinstance(event.part, TextPart) and event.part.content:
                                segment_text += event.part.content
                                run.full_text += event.part.content
                                await _emit(TextDelta(delta=event.part.content, agent_id=agent_id).model_dump_json())
                            elif isinstance(event, PartDeltaEvent):
                                if isinstance(event.delta, TextPartDelta) and event.delta.content_delta:
                                    segment_text += event.delta.content_delta
                                    run.full_text += event.delta.content_delta
                                    await _emit(TextDelta(delta=event.delta.content_delta, agent_id=agent_id).model_dump_json())
                                elif isinstance(event.delta, ThinkingPartDelta):
                                    await _emit(ThinkingDelta(delta=event.delta.content_delta or "", agent_id=agent_id).model_dump_json())
                    # Persist this text segment immediately so reload interleaves correctly
                    if segment_text:
                        msg: dict = {
                            "role": "assistant",
                            "content": segment_text,
                            "timestamp": _iso_now(),
                        }
                        if agent_id:
                            msg["agent_id"] = agent_id
                        storage.append_message(convo_id, msg)
                elif active_agent.is_call_tools_node(node):
                    # Stream tool call and result events
                    async with node.stream(agent_run.ctx) as tool_stream:
                        async for event in tool_stream:
                            if isinstance(event, FunctionToolCallEvent):
                                ev: dict = {
                                    "type": "tool-use",
                                    "name": event.part.tool_name,
                                    "input": str(event.part.args)[:200],
                                }
                                if agent_id:
                                    ev["agent_id"] = agent_id
                                await _emit(json.dumps(ev))
                                persisted: dict = {
                                    "role": "tool",
                                    "name": event.part.tool_name,
                                    "input": str(event.part.args)[:200],
                                    "timestamp": _iso_now(),
                                }
                                if agent_id:
                                    persisted["agent_id"] = agent_id
                                storage.append_message(convo_id, persisted)
                            elif isinstance(event, FunctionToolResultEvent):
                                output = str(event.content)[:500] if event.content else "OK"
                                ev = {
                                    "type": "tool-result",
                                    "name": event.result.tool_name if hasattr(event.result, "tool_name") else "",
                                    "output": output,
                                }
                                if agent_id:
                                    ev["agent_id"] = agent_id
                                await _emit(json.dumps(ev))

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

            # Persist agent history (per-agent if multi-agent)
            storage.save_agent_history(
                convo_id,
                ModelMessagesTypeAdapter.dump_json(run.message_history),
                agent_id=agent_id,
            )

            # Persist cost/context metadata (text segments already persisted above)
            meta_msg: dict = {
                "role": "assistant",
                "content": "",
                "timestamp": _iso_now(),
                "cost": cost,
                "turns": turns,
                "context_tokens": context_tokens,
                "context_limit": context_limit,
            }
            if agent_id:
                meta_msg["agent_id"] = agent_id
            storage.append_message(convo_id, meta_msg)

            done = Done(cost=cost, turns=turns, context_tokens=context_tokens, context_limit=context_limit, agent_id=agent_id)
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


@api.patch("/convos/{convo_id}", response_model=ConvoMeta)
async def api_update_convo(convo_id: str, body: ConvoUpdate):
    if body.title is not None:
        meta = storage.update_conversation_title(convo_id, body.title)
        if not meta:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return meta
    raise HTTPException(status_code=400, detail="No fields to update")


@api.delete("/convos/{convo_id}", status_code=204)
async def api_delete_convo(convo_id: str):
    if not storage.delete_conversation(convo_id):
        raise HTTPException(status_code=404, detail="Conversation not found")


# -- Agents ------------------------------------------------------------------

@api.get("/agents")
async def api_list_global_agents():
    """List global (default) agents."""
    return [a.model_dump() for a in storage.load_global_agents()]


@api.put("/agents")
async def api_save_global_agents(body: list[AgentConfig]):
    """Save global (default) agents."""
    storage.save_global_agents(body)
    return [a.model_dump() for a in body]


@api.get("/projects/{project_id}/agents")
async def api_list_agents(project_id: str):
    """List agents for a project (per-project override or global fallback)."""
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
    """Save per-project agent override."""
    proj = storage.get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    storage.save_project_agents(project_id, body)
    return [a.model_dump() for a in body]


@api.delete("/projects/{project_id}/agents")
async def api_delete_project_agents(project_id: str):
    """Remove per-project override, revert to global agents."""
    proj = storage.get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    storage.delete_project_agents(project_id)
    return {"ok": True}


# -- Files -------------------------------------------------------------------

@api.get("/projects/{project_id}/file")
async def api_read_file(project_id: str, path: str):
    """Read a file from the project's workdir for the artifact panel."""
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
    # Cap at 200KB
    if len(content) > 200_000:
        content = content[:200_000] + "\n\n--- truncated at 200KB ---"
    return {"path": path, "content": content}


from pydantic import BaseModel as _BaseModel


class FileWrite(_BaseModel):
    path: str
    content: str


@api.post("/projects/{project_id}/file")
async def api_write_file(project_id: str, body: FileWrite):
    """Write a file in the project's workdir."""
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


_EXCLUDED_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv",
                  ".next", "dist", "build", ".cache", ".mypy_cache", ".ruff_cache"}


@api.get("/projects/{project_id}/files")
async def api_list_files(project_id: str):
    """List all files in the project's workdir (recursive, filtered)."""
    proj = storage.get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    project_path = Path(proj.path).resolve()
    if not project_path.exists() or not project_path.is_dir():
        raise HTTPException(status_code=400, detail="Project path does not exist")
    files: list[str] = []
    for root, dirs, filenames in os.walk(project_path):
        # Filter excluded dirs in-place to prevent os.walk from descending
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




# ---------------------------------------------------------------------------
# Frontend SPA (catch-all — must be last)
# ---------------------------------------------------------------------------


@app.get("/{rest:path}", response_class=HTMLResponse)
@app.get("/", response_class=HTMLResponse)
async def chat_page(rest: str = ""):
    if not WS_TOKEN:
        return Response("Chat not configured", status_code=503)
    if not FRONTEND_DIR.exists() or not (FRONTEND_DIR / "index.html").exists():
        return Response("Frontend not built. Run: cd frontend && bun run build", status_code=503)
    # Serve static assets from dist/ (JS, CSS, etc.)
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
    # Clean up stale connections first (e.g. from navigation between convos)
    stale = []
    for k, other_ws in active_ws.items():
        if k != convo_id:
            try:
                if other_ws.client_state.name != "CONNECTED":
                    stale.append(k)
            except Exception:
                stale.append(k)
    for k in stale:
        del active_ws[k]
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

        # ----- Load agent configs for the project -----
        project_agents = storage.load_project_agents(project.id)

        # ----- Caches for the session -----
        # Agent instances: reuse across messages instead of recreating
        _agent_cache: dict[str | None, "Agent"] = {}
        # Project instructions: CLAUDE.md + dir tree (rarely changes mid-session)
        _UNSET = object()
        _cached_instructions: str | None | object = _UNSET
        _cached_instructions_subsequent: str | None = None

        # ----- Load existing message history -----
        # Per-agent histories: agent_id → (message_history, last_context_tokens)
        agent_histories: dict[str | None, tuple[list, int]] = {}
        # Cache JSONL messages to avoid repeated disk reads
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
            """Load message history for a specific agent (or default)."""
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
                            # Match agent_id for multi-agent, or accept any for legacy
                            if aid is None or msg.get("agent_id") == aid:
                                ctx_tokens = msg["context_tokens"]
                                break
                    print(f"ws[{convo_id[:8]}]: restored {len(hist)} messages for agent={aid or 'default'}")
                except Exception as e:
                    print(f"ws[{convo_id[:8]}]: failed to restore history for agent={aid}: {e}")
                    hist = []
            agent_histories[aid] = (hist, ctx_tokens)
            return hist, ctx_tokens

        # Pre-load default agent history
        _load_history(None)

        # ----- Check for active run (reconnection scenario) -----
        existing_run = active_runs.get(convo_id)
        if existing_run and existing_run.status == "running":
            existing_run.subscribers.add(ws)
            await ws.send_text(Running().model_dump_json())
            for event_str in existing_run.events:
                await ws.send_text(event_str)
            print(f"ws[{convo_id[:8]}]: subscribed to active run ({len(existing_run.events)} events buffered)")
        elif existing_run and existing_run.status in ("done", "error"):
            agent_histories[None] = (existing_run.message_history, existing_run.last_context_tokens)
            if active_runs.get(convo_id) is existing_run:
                del active_runs[convo_id]

        # ----- Chat loop -----
        while True:
            prompt = await ws.receive_text()

            # Sync state from a completed run
            completed_run = active_runs.get(convo_id)
            if completed_run and completed_run.task and completed_run.task.done():
                agent_histories[None] = (completed_run.message_history, completed_run.last_context_tokens)
                if active_runs.get(convo_id) is completed_run:
                    del active_runs[convo_id]
            elif completed_run and completed_run.status == "running":
                await ws.send_text(
                    Error(message="Agent is still running", recoverable=True).model_dump_json()
                )
                continue

            # Handle /compact command (compacts default agent history)
            if prompt.strip() == "/compact":
                hist, ctx_tokens = _load_history(None)
                if hist:
                    old_tokens = ctx_tokens
                    hist, summary = await compact(hist)
                    if summary:
                        est_tokens = sum(len(str(m)) for m in hist) // 4
                        agent_histories[None] = (hist, est_tokens)
                        storage.append_message(convo_id, {
                            "role": "tool",
                            "name": "compact",
                            "input": f"{old_tokens / 1000:.1f}k → {est_tokens / 1000:.1f}k tokens",
                            "timestamp": _iso_now(),
                        })
                        storage.save_agent_history(
                            convo_id,
                            ModelMessagesTypeAdapter.dump_json(hist),
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

            # Invalidate cached messages since we're about to append
            _invalidate_message_cache()

            # Persist the user message
            storage.append_message(convo_id, {
                "role": "user",
                "content": prompt,
                "timestamp": _iso_now(),
            })

            # Mark conversation as running
            storage.update_conversation_status(convo_id, ConvoStatus.running)

            # Determine target agents
            if project_agents:
                target_agents, cleaned_prompt = parse_mentions(prompt, project_agents)
            else:
                target_agents = [None]  # None = use default global agent
                cleaned_prompt = prompt

            # Extract @file references and inject content
            file_refs, cleaned_prompt = extract_file_mentions(cleaned_prompt, project_path)
            if file_refs:
                file_context = "\n\n".join(
                    f"[File: {path}]\n```\n{content}\n```"
                    for path, content in file_refs
                )
                cleaned_prompt = f"{file_context}\n\n{cleaned_prompt}"

            # Notify client that the run is starting
            await ws.send_text(Running().model_dump_json())

            # Set workdir
            agent_tools.set_workdir(project_path)

            # Build project instructions in a thread to avoid blocking event loop
            # Cache after first turn since CLAUDE.md rarely changes mid-conversation
            if _cached_instructions is _UNSET:
                _cached_instructions = await asyncio.to_thread(
                    build_project_instructions, project_path, True
                )
                _cached_instructions_subsequent = await asyncio.to_thread(
                    build_project_instructions, project_path, False
                )

            # Launch a RunState per target agent
            runs: list[RunState] = []
            for ac in target_agents:
                aid = ac.id if ac else None
                hist, ctx_tokens = _load_history(aid)

                # Auto-compact if over budget
                if hist and needs_compaction(ctx_tokens):
                    old_tokens = ctx_tokens
                    hist, summary = await compact(hist)
                    if summary:
                        est_tokens = sum(len(str(m)) for m in hist) // 4
                        agent_histories[aid] = (hist, est_tokens)
                        storage.append_message(convo_id, {
                            "role": "tool",
                            "name": "compact",
                            "input": f"{old_tokens / 1000:.1f}k → {est_tokens / 1000:.1f}k tokens (auto)",
                            "timestamp": _iso_now(),
                        })
                        storage.save_agent_history(
                            convo_id,
                            ModelMessagesTypeAdapter.dump_json(hist),
                            agent_id=aid,
                        )
                        await ws.send_text(
                            Compacted(old_tokens=old_tokens, new_tokens=est_tokens).model_dump_json()
                        )

                is_first_turn = len(hist) == 0
                instructions = _cached_instructions if is_first_turn else _cached_instructions_subsequent

                # Build the prompt — prepend shared conversation context so
                # this agent can see what other agents and the user discussed
                agent_prompt = cleaned_prompt
                if ac:
                    shared_ctx = _build_shared_context(convo_id, aid, cached_messages=_get_cached_messages())
                    if shared_ctx:
                        agent_prompt = (
                            f"[Conversation context]\n{shared_ctx}\n\n"
                            f"[New message from user]\n{cleaned_prompt}"
                        )

                # Send agent-start event for multi-agent
                if ac:
                    await ws.send_text(AgentStart(
                        agent_id=ac.id, agent_name=ac.name, agent_color=ac.color,
                    ).model_dump_json())

                agent_instance = _agent_cache.get(ac.id if ac else None) or create_agent(ac)
                if ac:
                    _agent_cache[ac.id] = agent_instance
                else:
                    _agent_cache[None] = agent_instance

                run = RunState(
                    convo_id=convo_id,
                    message_history=list(hist),
                )
                run.subscribers.add(ws)
                active_runs[convo_id] = run  # last one wins for reconnect

                run.task = asyncio.create_task(
                    _run_agent_task(
                        run, agent_prompt, hist, convo_id,
                        instructions=instructions,
                        agent_instance=agent_instance,
                        agent_id=aid,
                    )
                )
                runs.append(run)

            # Wait for all runs to complete
            try:
                await asyncio.gather(*[r.task for r in runs if r.task], return_exceptions=True)
            except asyncio.CancelledError:
                pass

            # Sync state from completed runs
            for r in runs:
                if r.status == "done":
                    # Determine which agent this run was for
                    aid = None
                    if r.done_event and r.done_event.get("agent_id"):
                        aid = r.done_event["agent_id"]
                    agent_histories[aid] = (r.message_history, r.last_context_tokens)

    except WebSocketDisconnect:
        # Unsubscribe from any active run (task continues in background)
        run = active_runs.get(convo_id)
        if run:
            run.subscribers.discard(ws)
            print(f"ws[{convo_id[:8]}]: disconnected, run continues in background")
    finally:
        if active_ws.get(convo_id) is ws:
            del active_ws[convo_id]
        print(f"ws[{convo_id[:8]}]: disconnected (active: {len(active_ws)})")
