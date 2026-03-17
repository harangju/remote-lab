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
from types import SimpleNamespace

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import HTMLResponse, Response
import mimetypes
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
from backend.protocol import AuthOk, MessageAck, TextDelta, ThinkingDelta, Done, Running, AgentStart, Compacted, SkillResult, ToolConfirm, TitleUpdated, VoiceState, VoiceTranscript, Error, FileChanged, ToolResult, ToolOutput
from backend.skills import get_skills, get_skill, SkillType
from backend.permissions import is_tool_auto_allowed, add_project_rule, tool_is_always_confirmed, build_project_rule
from backend.models import (
    Project, ProjectCreate, ProjectUpdate,
    ConvoMeta, ConvoCreate, ConvoUpdate, ConvoDetail,
    ConvoStatus, UploadResult,
)
from backend import storage
from backend import tools as agent_tools
from backend.stt import DeepgramSTTSession


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
    stt_session: DeepgramSTTSession | None = None
    stt_partial: str = ""
    stt_final: str = ""


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


_seen_tool_call_ids: dict[str, set[str]] = {}


async def _append_event(convo_id: str, event: dict) -> None:
    event_type = str(event.get("type", ""))
    if event_type == "tool-call":
        tool_call_id = str(event.get("tool_call_id", ""))
        if tool_call_id:
            seen = _seen_tool_call_ids.setdefault(convo_id, set())
            if tool_call_id in seen:
                return
            seen.add(tool_call_id)
    async with _get_convo_lock(convo_id):
        storage.append_event(convo_id, event)


async def _append_message(convo_id: str, event: dict) -> None:
    await _append_event(convo_id, event)


def _user_event(content: str, message_id: str | None = None, attachments: list[dict[str, Any]] | None = None, *, server_command: bool = False, bash_mode: bool = False) -> dict[str, Any]:
    event: dict[str, Any] = {
        "type": "user-message",
        "role": "user",
        "content": content,
        "timestamp": _iso_now(),
    }
    if message_id:
        event["message_id"] = message_id
    if attachments:
        event["attachments"] = attachments
    if server_command:
        event["server_command"] = True
    if bash_mode:
        event["bash_mode"] = True
    return event


def _tool_event(name: str, *, event_type: str = "tool-result", input: str | None = None, output: str | None = None, run_id: str | None = None, agent_id: str | None = None, tool_call_id: str | None = None) -> dict[str, Any]:
    event: dict[str, Any] = {
        "type": event_type,
        "role": "tool",
        "name": name,
        "timestamp": _iso_now(),
    }
    if input is not None:
        event["input"] = input
    if output is not None:
        event["output"] = output
    if run_id:
        event["run_id"] = run_id
    if agent_id:
        event["agent_id"] = agent_id
    if tool_call_id:
        event["tool_call_id"] = tool_call_id
    return event


def _system_event(content: str, *, event_type: str = "system", run_id: str | None = None, recoverable: bool | None = None) -> dict[str, Any]:
    event: dict[str, Any] = {
        "type": event_type,
        "content": content,
        "message": content,
        "timestamp": _iso_now(),
    }
    if run_id:
        event["run_id"] = run_id
    if recoverable is not None:
        event["recoverable"] = recoverable
    return event


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
    events = cached_messages if cached_messages is not None else storage.read_events(convo_id)
    if not events:
        return ""

    recent = events[-max_messages:]
    lines: list[str] = []
    tool_calls: dict[str, dict[str, Any]] = {}
    tool_order: list[str] = []

    def _append_tool_summary(tc_id: str) -> None:
        item = tool_calls.get(tc_id)
        if not item:
            return
        aid = item.get("agent_id")
        name = item.get("name", "")
        inp = item.get("input", "")
        out = item.get("output", "")
        prefix = f"[@{aid}] " if aid and aid != agent_id else ""
        summary = f"{prefix}Tool {name}"
        if inp:
            summary += f" input={inp}"
        if out:
            summary += f" output={out}"
        lines.append(summary)

    for event in recent:
        event_type = event.get("type")
        role = event.get("role", "")
        if event_type == "tool-call":
            tc_id = event.get("tool_call_id") or uuid4().hex
            tool_calls[tc_id] = {
                "agent_id": event.get("agent_id"),
                "name": event.get("name", ""),
                "input": event.get("input", ""),
                "output": "",
            }
            tool_order.append(tc_id)
            continue
        if event_type == "tool-output":
            tc_id = event.get("tool_call_id")
            if tc_id and tc_id in tool_calls:
                tool_calls[tc_id]["output"] = f"{tool_calls[tc_id].get('output', '')}{event.get('output', '')}"
            continue
        if event_type == "tool-result":
            tc_id = event.get("tool_call_id")
            if tc_id and tc_id in tool_calls:
                tool_calls[tc_id]["output"] = event.get("output", "")
                _append_tool_summary(tc_id)
                tool_calls.pop(tc_id, None)
                if tc_id in tool_order:
                    tool_order.remove(tc_id)
            else:
                name = event.get("name", "")
                out = event.get("output", "")
                lines.append(f"Tool {name} output={out}")
            continue
        if event_type == "user-message" or role == "user":
            if event.get("server_command"):
                continue
            lines.append(f"User: {event.get('content', '')}")
        elif event_type == "assistant-message" or role == "assistant":
            content = event.get("content", "")
            if not content:
                continue
            aid = event.get("agent_id")
            if aid and aid != agent_id:
                lines.append(f"[@{aid}]: {content}")
            elif aid == agent_id:
                lines.append(f"You (earlier): {content}")
            else:
                lines.append(f"Assistant: {content}")
        elif event_type in {"system", "run-error"}:
            content = event.get("content") or event.get("message", "")
            if content:
                lines.append(f"System: {content}")

    for tc_id in list(tool_order):
        _append_tool_summary(tc_id)

    if not lines:
        return ""
    return "\n".join(lines)


async def _run_bash_command_task(run: RunState, command: str, convo_id: str) -> None:
    async def _emit(msg_str: str):
        try:
            payload = json.loads(msg_str)
        except Exception:
            payload = None
        if isinstance(payload, dict):
            payload.setdefault("run_id", run.run_id)
            if payload.get("type") == "tool-output":
                await _append_event(convo_id, {
                    "type": "tool-output",
                    "name": payload.get("name", ""),
                    "output": payload.get("output", ""),
                    "timestamp": _iso_now(),
                    "run_id": payload.get("run_id"),
                })
            msg_str = json.dumps(payload)
        run.events.append(msg_str)
        await run.broadcast(msg_str)

    async def _wait_for_approval(tool_call_id: str, command_input: dict[str, str]) -> bool:
        convo_meta = storage._read_meta(convo_id)
        convo_autonomous = bool(convo_meta.autonomous_tools_enabled) if convo_meta else False
        if is_tool_auto_allowed(get_workdir(), convo_autonomous, "bash", command_input):
            return True

        run.pending_approvals = {tool_call_id}
        run.pending_approval_details = {tool_call_id: {"name": "bash", "args": command_input}}
        run.approval_decisions = {}
        run.approval_event = asyncio.Event()
        always_confirm = tool_is_always_confirmed("bash", command_input)
        await _emit(ToolConfirm(
            tool_call_id=tool_call_id,
            name="bash",
            run_id=run.run_id,
            args=json.dumps(command_input),
            can_allow_project=not always_confirm,
        ).model_dump_json())
        await run.approval_event.wait()
        approved = bool(run.approval_decisions.get(tool_call_id, False))
        run.pending_approvals.clear()
        run.pending_approval_details.clear()
        return approved

    agent_tools.set_broadcast(_emit)
    try:
        command_input = {"command": command}
        tool_call_id = f"bash-{uuid4().hex[:8]}"
        tool_call_event = {
            "type": "tool-call",
            "role": "tool",
            "name": "bash",
            "input": json.dumps(command_input),
            "tool_call_id": tool_call_id,
            "timestamp": _iso_now(),
            "run_id": run.run_id,
        }
        await _append_event(convo_id, tool_call_event)
        await _emit(json.dumps({**tool_call_event, "type": "tool-use"}))

        approved = await _wait_for_approval(tool_call_id, command_input)
        if not approved:
            event = _system_event("User denied this tool call", event_type="run-error", run_id=run.run_id, recoverable=True)
            await _append_event(convo_id, event)
            await _emit(json.dumps({**event, "type": "error"}))
            run.status = "error"
            await _update_conversation_status(convo_id, ConvoStatus.idle)
            return

        if build_project_rule("bash", command_input) is None:
            event = _system_event("Invalid bash command", event_type="run-error", run_id=run.run_id, recoverable=True)
            await _append_event(convo_id, event)
            await _emit(json.dumps({**event, "type": "error"}))
            run.status = "error"
            await _update_conversation_status(convo_id, ConvoStatus.error)
            return

        result = await agent_tools._bash(SimpleNamespace(), command)
        output = result[:500] if result else "OK"
        await _append_event(convo_id, {
            "type": "tool-result",
            "role": "tool",
            "name": "bash",
            "output": output,
            "tool_call_id": tool_call_id,
            "timestamp": _iso_now(),
            "run_id": run.run_id,
        })
        await _emit(ToolResult(name="bash", output=output, run_id=run.run_id).model_dump_json())

        meta_msg = {
            "type": "assistant-message",
            "role": "assistant",
            "content": "",
            "timestamp": _iso_now(),
            "turns": 0,
            "context_tokens": 0,
            "context_limit": 0,
            "run_id": run.run_id,
        }
        await _append_message(convo_id, meta_msg)

        done = Done(turns=0, run_id=run.run_id, context_tokens=0, context_limit=0)
        run.done_event = done.model_dump()
        run.status = "done"
        await _emit(done.model_dump_json())
        await _update_conversation_status(convo_id, ConvoStatus.done)
    except asyncio.CancelledError:
        run.status = "error"
        await _update_conversation_status(convo_id, ConvoStatus.idle)
        event = _system_event("Run stopped", event_type="run-error", run_id=run.run_id, recoverable=True)
        await _append_event(convo_id, event)
        await _emit(json.dumps({**event, "type": "error"}))
        raise
    except Exception as e:
        run.error_msg = str(e)
        run.status = "error"
        await _update_conversation_status(convo_id, ConvoStatus.error)
        event = _system_event(str(e), event_type="run-error", run_id=run.run_id, recoverable=True)
        await _append_event(convo_id, event)
        await _emit(json.dumps({**event, "type": "error"}))
    finally:
        agent_tools.clear_broadcast()
        await asyncio.sleep(10)
        session = sessions.get(convo_id)
        if session and session.run is run:
            session.run = None
            if not session.subscribers and session.controller is None:
                sessions.pop(convo_id, None)


async def _run_agent_task(
    run: RunState, prompt: str, message_history: list, convo_id: str,
    instructions: str | None = None,
    agent_instance: "Agent | None" = None,
    agent_id: str | None = None,
):
    active_agent = agent_instance or agent

    async def _emit(msg_str: str):
        try:
            payload = json.loads(msg_str)
        except Exception:
            payload = None
        if isinstance(payload, dict):
            payload.setdefault("run_id", run.run_id)
            if agent_id and payload.get("agent_id") is None:
                payload["agent_id"] = agent_id
            if payload.get("type") == "tool-output":
                await _append_event(convo_id, {
                    "type": "tool-output",
                    "name": payload.get("name", ""),
                    "output": payload.get("output", ""),
                    "timestamp": _iso_now(),
                    "run_id": payload.get("run_id"),
                    **({"agent_id": agent_id} if agent_id else {}),
                })
            msg_str = json.dumps(payload)
        run.events.append(msg_str)
        await run.broadcast(msg_str)

    agent_tools.set_broadcast(_emit)

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
                                "type": "assistant-message",
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
                                    tool_call_id = getattr(event.part, "tool_call_id", "") or ""
                                    ev = {
                                        "type": "tool-call",
                                        "role": "tool",
                                        "name": event.part.tool_name,
                                        "input": str(event.part.args)[:200],
                                        "tool_call_id": tool_call_id,
                                        "timestamp": _iso_now(),
                                        "run_id": run.run_id,
                                    }
                                    if agent_id:
                                        ev["agent_id"] = agent_id
                                    await _append_event(convo_id, ev)
                                    await _emit(json.dumps({**ev, "type": "tool-use"}))
                                elif isinstance(event, FunctionToolResultEvent):
                                    output = str(event.content)[:500] if event.content else "OK"
                                    ev = {
                                        "type": "tool-result",
                                        "name": event.result.tool_name if hasattr(event.result, "tool_name") else "",
                                        "output": output,
                                        "tool_call_id": getattr(event.result, "tool_call_id", "") or "",
                                        "timestamp": _iso_now(),
                                        "run_id": run.run_id,
                                    }
                                    if agent_id:
                                        ev["agent_id"] = agent_id
                                    await _append_event(convo_id, ev)
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
            "type": "assistant-message",
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
        event = _system_event("Run stopped", event_type="run-error", run_id=run.run_id, recoverable=True)
        await _append_event(convo_id, event)
        await _emit(json.dumps({**event, "type": "error"}))
        raise
    except Exception as e:
        run.error_msg = str(e)
        run.status = "error"
        await _update_conversation_status(convo_id, ConvoStatus.error)
        event = _system_event(str(e), event_type="run-error", run_id=run.run_id, recoverable=True)
        await _append_event(convo_id, event)
        await _emit(json.dumps({**event, "type": "error"}))
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
async def api_get_convo(convo_id: str, before: int | None = None, limit: int | None = None):
    convo = storage.get_conversation(convo_id, before=before, limit=limit)
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


@api.get("/projects/{project_id}/file/raw")
async def api_read_file_raw(project_id: str, path: str):
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
    media_type, _ = mimetypes.guess_type(str(target))
    return Response(target.read_bytes(), media_type=media_type or "application/octet-stream")


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


def _sanitize_upload_name(name: str) -> str:
    cleaned = Path(name).name.strip().replace("\x00", "")
    if not cleaned:
        return "upload"
    return "".join(ch if ch.isalnum() or ch in {".", "-", "_"} else "-" for ch in cleaned)


def _upload_kind(mime_type: str, filename: str) -> str:
    image_exts = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
    if mime_type.startswith("image/") or Path(filename).suffix.lower() in image_exts:
        return "image"
    return "file"


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


@api.post("/projects/{project_id}/uploads", response_model=list[UploadResult])
async def api_upload_files(project_id: str, files: list[UploadFile] = File(...)):
    proj = storage.get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    project_path = Path(proj.path).resolve()
    if not project_path.exists() or not project_path.is_dir():
        raise HTTPException(status_code=400, detail="Project path does not exist")
    now = datetime.now(timezone.utc)
    upload_dir = project_path / ".remote-lab" / "uploads" / now.strftime("%Y") / now.strftime("%m")
    upload_dir.mkdir(parents=True, exist_ok=True)
    results: list[UploadResult] = []
    total_size = 0
    for upload in files:
        content = await upload.read()
        size = len(content)
        total_size += size
        if size > 50 * 1024 * 1024:
            raise HTTPException(status_code=400, detail=f"File too large: {upload.filename}")
        if total_size > 100 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Total upload size exceeds 100 MB")
        safe_name = _sanitize_upload_name(upload.filename or "upload")
        stored_name = f"{uuid4().hex[:12]}-{safe_name}"
        target = (upload_dir / stored_name).resolve()
        if not str(target).startswith(str(project_path)):
            raise HTTPException(status_code=403, detail="Invalid upload path")
        target.write_bytes(content)
        rel_path = str(target.relative_to(project_path))
        mime_type = upload.content_type or "application/octet-stream"
        results.append(UploadResult(
            path=rel_path,
            name=upload.filename or safe_name,
            mime_type=mime_type,
            size=size,
            kind=_upload_kind(mime_type, safe_name),
        ))
    return results


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


def _sanitize_public_name(name: str) -> str:
    cleaned = Path(name).name.strip().replace("\x00", "")
    safe = "".join(ch if ch.isalnum() or ch in {".", "-", "_"} else "-" for ch in cleaned)
    return safe or "shared-file"


def _public_url_base(ws: WebSocket) -> str:
    if PUBLIC_BASE_URL:
        return PUBLIC_BASE_URL
    origin = ws.headers.get("origin", "").strip().rstrip("/")
    if origin:
        return origin
    host = ws.headers.get("host", "").strip()
    if not host:
        return ""
    proto = "https" if ws.url.scheme == "wss" else "http"
    return f"{proto}://{host}"


def _share_output_name(output_name: str) -> str:
    path = Path(output_name)
    if path.suffix.lower() in {".html", ".md"}:
        return path.stem
    return output_name


def _shared_access_key(name: str) -> str:
    path = Path(name)
    if path.suffix.lower() in {".html", ".md"}:
        return path.stem
    return path.name


def _load_public_access() -> dict[str, list[str]]:
    access_file = PUBLIC_DIR / ".access.json"
    try:
        data = json.loads(access_file.read_text())
        if isinstance(data, dict):
            return {str(k): [str(v) for v in values if isinstance(v, str)] for k, values in data.items() if isinstance(values, list)}
    except Exception:
        pass
    return {}


def _save_public_access(rules: dict[str, list[str]]) -> None:
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    access_file = PUBLIC_DIR / ".access.json"
    access_file.write_text(json.dumps(rules, indent=2, sort_keys=True) + "\n")


def _share_output(output_name: str, ws: WebSocket, token: str | None = None) -> str:
    public_name = _share_output_name(output_name)
    path = f"/{public_name}"
    if token:
        path = f"{path}?t={token}"
    base = _public_url_base(ws)
    if base:
        full_url = f"{base}{path}"
        return f"Shared to {full_url}"
    return f"Shared to {path}"


def _share_url_for_slug(slug: str, ws: WebSocket, token: str | None = None) -> str:
    path = f"/{slug}"
    if token:
        path = f"{path}?t={token}"
    base = _public_url_base(ws)
    if base:
        return f"{base}{path}"
    return path


def _resolve_share_source(project_root: Path, raw_path: str) -> tuple[Path | None, str | None]:
    allowed_exts = {".md", ".html", ".pdf"}
    rel_path = raw_path.strip()
    if rel_path.startswith("@"):
        rel_path = rel_path[1:]
    rel_path = rel_path.strip()
    if not rel_path:
        return None, "Usage: /share <project-relative .md, .html, or .pdf file>"

    direct = (project_root / rel_path).resolve()
    if not str(direct).startswith(str(project_root)):
        return None, "Source file must be inside the current project"
    if direct.is_file() and direct.suffix.lower() in allowed_exts:
        return direct, None

    search_terms: list[str] = []
    if rel_path:
        search_terms.append(rel_path)
        rel_obj = Path(rel_path)
        if rel_obj.suffix.lower() not in allowed_exts:
            search_terms.extend([f"{rel_path}.md", f"{rel_path}.html", f"{rel_path}.pdf"])
        name = rel_obj.name
        if name and name not in search_terms:
            search_terms.append(name)
        if name and Path(name).suffix.lower() not in allowed_exts:
            search_terms.extend([f"{name}.md", f"{name}.html", f"{name}.pdf"])

    candidates: list[Path] = []
    seen: set[str] = set()
    for file_path in project_root.rglob("*"):
        if not file_path.is_file():
            continue
        if file_path.suffix.lower() not in allowed_exts:
            continue
        try:
            rel = str(file_path.relative_to(project_root))
        except ValueError:
            continue
        rel_lower = rel.lower()
        name_lower = file_path.name.lower()
        if any(rel_lower == term.lower() or name_lower == term.lower() for term in search_terms):
            if rel not in seen:
                seen.add(rel)
                candidates.append(file_path)

    if len(candidates) == 1:
        return candidates[0], None
    if len(candidates) > 1:
        options = ", ".join(str(p.relative_to(project_root)) for p in sorted(candidates)[:5])
        more = "" if len(candidates) <= 5 else f", ... ({len(candidates)} matches)"
        return None, f"Multiple matching files found: {options}{more}"
    return None, "No matching .md, .html, or .pdf file found"


def _parse_share_args(cmd_args: str) -> tuple[str, str | None]:
    raw = cmd_args.strip()
    if not raw:
        return "", None
    parts = raw.rsplit(None, 1)
    if len(parts) == 2 and parts[1].strip():
        candidate_path, candidate_token = parts[0].strip(), parts[1].strip()
        if candidate_path:
            return candidate_path, candidate_token
    return raw, None


async def _handle_share(cmd_args: str, project_path: Path, ws: WebSocket) -> str:
    project_root = project_path.resolve()
    source_arg, token_arg = _parse_share_args(cmd_args)
    source, error = _resolve_share_source(project_root, source_arg)
    if error:
        return error
    assert source is not None

    ext = source.suffix.lower()
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

    if ext in {".html", ".pdf"}:
        output_name = _sanitize_public_name(source.name)
        destination = (PUBLIC_DIR / output_name).resolve()
        if destination.parent != PUBLIC_DIR.resolve():
            return "Invalid destination"
        destination.write_bytes(source.read_bytes())
    else:
        content = source.read_text(errors="replace")
        is_marp = content.lstrip().startswith("---") and "marp:" in content[:500]
        if is_marp:
            output_name = _sanitize_public_name(f"{source.stem}.html")
            destination = (PUBLIC_DIR / output_name).resolve()
            if destination.parent != PUBLIC_DIR.resolve():
                return "Invalid destination"
            proc = await asyncio.create_subprocess_exec(
                "marp", "--html", str(source), "-o", str(destination),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await proc.communicate()
            if proc.returncode != 0:
                err = stderr.decode(errors="replace").strip()
                return f"Marp build failed: {err or 'unknown error'}"
        else:
            output_name = _sanitize_public_name(source.name)
            destination = (PUBLIC_DIR / output_name).resolve()
            if destination.parent != PUBLIC_DIR.resolve():
                return "Invalid destination"
            destination.write_text(content)

    access_key = _shared_access_key(output_name)
    rules = _load_public_access()
    existing_tokens = [t for t in rules.get(access_key, []) if t]
    token = token_arg or (existing_tokens[0] if existing_tokens else uuid4().hex[:12])
    rules[access_key] = [token]
    _save_public_access(rules)
    return _share_output(output_name, ws, token=token)


def _resolve_unshare_target(public_root: Path, raw_path: str) -> str | None:
    rel_path = raw_path.strip()
    if rel_path.startswith("@"):
        rel_path = rel_path[1:]
    rel_path = rel_path.strip()
    if not rel_path:
        return None
    direct = (public_root / rel_path).resolve()
    if str(direct).startswith(str(public_root)) and direct.is_file() and direct.suffix.lower() in {".md", ".html", ".pdf"}:
        return _shared_access_key(direct.name)
    return _shared_access_key(rel_path)


async def _handle_shares(ws: WebSocket) -> str:
    rules = _load_public_access()
    public_root = PUBLIC_DIR.resolve()
    shared_files: dict[str, str] = {}
    if public_root.exists():
        for file_path in sorted(public_root.iterdir()):
            if not file_path.is_file() or file_path.name.startswith("."):
                continue
            if file_path.suffix.lower() not in {".md", ".html", ".pdf"}:
                continue
            shared_files[_shared_access_key(file_path.name)] = file_path.name

    if not shared_files:
        return "No shared files"

    lines: list[str] = []
    for slug, filename in shared_files.items():
        tokens = [t for t in rules.get(slug, []) if t]
        url = _share_url_for_slug(slug, ws, tokens[0] if tokens else None)
        lines.append(f"{filename}: {url}")
    return "\n".join(lines)


async def _handle_unshare(cmd_args: str) -> str:
    slug = _resolve_unshare_target(PUBLIC_DIR.resolve(), cmd_args)
    if not slug:
        return "Usage: /unshare <path-or-slug>"
    removed_files: list[str] = []
    pdf_target = (PUBLIC_DIR / slug).resolve()
    if pdf_target.parent == PUBLIC_DIR.resolve() and pdf_target.is_file() and pdf_target.suffix.lower() == ".pdf":
        pdf_target.unlink()
        removed_files.append(pdf_target.name)
    for ext in (".html", ".md"):
        target = (PUBLIC_DIR / f"{slug}{ext}").resolve()
        if target.parent == PUBLIC_DIR.resolve() and target.is_file():
            target.unlink()
            removed_files.append(target.name)
    rules = _load_public_access()
    rules.pop(slug, None)
    _save_public_access(rules)
    if not removed_files:
        return f"Nothing shared for {slug}"
    return f"Unshared {', '.join(removed_files)}"


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

        if convo.status == ConvoStatus.running and session.run is None:
            await _update_conversation_status(convo_id, ConvoStatus.error)
            restart_event = _system_event("Server restarted during run", event_type="run-error", recoverable=True)
            await _append_event(convo_id, restart_event)
            await ws.send_text(json.dumps(restart_event | {"type": "error"}))
            convo = storage.get_conversation(convo_id)

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
                _cached_messages = storage.read_events(convo_id)
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
            attachments: list[dict[str, Any]] = []

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
                    if ctrl.get("type") == "voice-start":
                        if session.run and session.run.status == "running":
                            await ws.send_text(Error(message="Voice input is unavailable while the assistant is running", recoverable=True).model_dump_json())
                            continue
                        if session.stt_session is not None:
                            await ws.send_text(Error(message="Voice input already active", recoverable=True).model_dump_json())
                            continue
                        session.stt_partial = ""
                        session.stt_final = ""
                        await ws.send_text(VoiceState(state="starting").model_dump_json())

                        async def _on_transcript(text: str, is_final: bool) -> None:
                            if is_final:
                                session.stt_final = f"{session.stt_final} {text}".strip()
                                session.stt_partial = ""
                            else:
                                session.stt_partial = text
                            combined = f"{session.stt_final} {session.stt_partial}".strip()
                            await ws.send_text(VoiceTranscript(text=combined, is_final=is_final).model_dump_json())

                        async def _on_voice_error(message: str) -> None:
                            await ws.send_text(Error(message=message, recoverable=True).model_dump_json())
                            await ws.send_text(VoiceState(state="stopped").model_dump_json())
                            session.stt_session = None
                            session.stt_partial = ""
                            session.stt_final = ""

                        async def _on_voice_state(state: str) -> None:
                            if state in {"listening", "stopped"}:
                                await ws.send_text(VoiceState(state=state).model_dump_json())

                        try:
                            stt = DeepgramSTTSession(_on_transcript, _on_voice_error, _on_voice_state)
                            await stt.start()
                            session.stt_session = stt
                        except Exception:
                            await ws.send_text(Error(message="Voice input failed. Your existing draft was preserved.", recoverable=True).model_dump_json())
                            await ws.send_text(VoiceState(state="stopped").model_dump_json())
                        continue
                    if ctrl.get("type") == "voice-audio":
                        stt = session.stt_session
                        if stt is None:
                            continue
                        chunk_b64 = ctrl.get("audio", "")
                        if not isinstance(chunk_b64, str) or not chunk_b64:
                            continue
                        import base64
                        try:
                            await stt.send_audio(base64.b64decode(chunk_b64))
                        except Exception:
                            await ws.send_text(Error(message="Voice input failed. Your existing draft was preserved.", recoverable=True).model_dump_json())
                        continue
                    if ctrl.get("type") == "voice-stop":
                        stt = session.stt_session
                        session.stt_session = None
                        if stt is not None:
                            try:
                                await stt.stop()
                            except Exception:
                                await ws.send_text(Error(message="Voice input failed. Your existing draft was preserved.", recoverable=True).model_dump_json())
                        session.stt_partial = ""
                        session.stt_final = ""
                        await ws.send_text(VoiceState(state="stopped").model_dump_json())
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
                        raw_text = str(ctrl.get("text", ""))
                        prompt = raw_text.strip()
                        message_id = str(ctrl.get("message_id", "")).strip() or None
                        raw_attachments = ctrl.get("attachments") or []
                        if isinstance(raw_attachments, list):
                            attachments = [a for a in raw_attachments if isinstance(a, dict) and a.get("path")]
                        if raw_text.startswith("\\!"):
                            prompt = raw_text[1:]
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
                        await _append_message(convo_id, _user_event(prompt, message_id=message_id, server_command=True))
                        _invalidate_message_cache()
                        for p in storage.CONVOS_DIR.glob(f"{convo_id}.agent*.json"):
                            parts = p.stem.replace(f"{convo_id}.agent", "")
                            aid = parts.lstrip(".") or None
                            _load_history(aid)

                        aids_to_compact = [aid for aid, (h, _) in agent_histories.items() if h]
                        if not aids_to_compact:
                            if message_id:
                                processed_message_ids.setdefault(convo_id, set()).add(message_id)
                                await ws.send_text(MessageAck(message_id=message_id).model_dump_json())
                                message_id = None
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
                                    await _append_message(convo_id, _tool_event("compact", event_type="compacted", output=f"{label}{old_tokens / 1000:.1f}k → {est_tokens / 1000:.1f}k tokens"))
                                    await _save_agent_history(convo_id, ModelMessagesTypeAdapter.dump_json(hist), agent_id=aid)
                                    if message_id:
                                        processed_message_ids.setdefault(convo_id, set()).add(message_id)
                                        await ws.send_text(MessageAck(message_id=message_id).model_dump_json())
                                        message_id = None
                                    await ws.send_text(Compacted(old_tokens=old_tokens, new_tokens=est_tokens).model_dump_json())
                            if not compacted_any:
                                if message_id:
                                    processed_message_ids.setdefault(convo_id, set()).add(message_id)
                                    await ws.send_text(MessageAck(message_id=message_id).model_dump_json())
                                    message_id = None
                                await ws.send_text(Error(message="Not enough history to compact", recoverable=True).model_dump_json())
                    elif skill.name == "model":
                        await _append_message(convo_id, _user_event(prompt, message_id=message_id, server_command=True))
                        _invalidate_message_cache()
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
                        await _append_message(convo_id, _tool_event("model", event_type="skill-result", output=output))
                        if message_id:
                            processed_message_ids.setdefault(convo_id, set()).add(message_id)
                            await ws.send_text(MessageAck(message_id=message_id).model_dump_json())
                        await ws.send_text(SkillResult(skill="model", output=output).model_dump_json())
                    elif skill.name == "share":
                        await _append_message(convo_id, _user_event(prompt, message_id=message_id, server_command=True))
                        _invalidate_message_cache()
                        output = await _handle_share(cmd_args, project_path, ws)
                        await _append_message(convo_id, _tool_event("share", event_type="skill-result", output=output))
                        if message_id:
                            processed_message_ids.setdefault(convo_id, set()).add(message_id)
                            await ws.send_text(MessageAck(message_id=message_id).model_dump_json())
                        await ws.send_text(SkillResult(skill="share", output=output).model_dump_json())
                    elif skill.name == "shares":
                        await _append_message(convo_id, _user_event(prompt, message_id=message_id, server_command=True))
                        _invalidate_message_cache()
                        output = await _handle_shares(ws)
                        await _append_message(convo_id, _tool_event("shares", event_type="skill-result", output=output))
                        if message_id:
                            processed_message_ids.setdefault(convo_id, set()).add(message_id)
                            await ws.send_text(MessageAck(message_id=message_id).model_dump_json())
                        await ws.send_text(SkillResult(skill="shares", output=output).model_dump_json())
                    elif skill.name == "unshare":
                        await _append_message(convo_id, _user_event(prompt, message_id=message_id, server_command=True))
                        _invalidate_message_cache()
                        output = await _handle_unshare(cmd_args)
                        await _append_message(convo_id, _tool_event("unshare", event_type="skill-result", output=output))
                        if message_id:
                            processed_message_ids.setdefault(convo_id, set()).add(message_id)
                            await ws.send_text(MessageAck(message_id=message_id).model_dump_json())
                        await ws.send_text(SkillResult(skill="unshare", output=output).model_dump_json())
                    continue
                elif skill and skill.type == SkillType.prompt:
                    user_text = cmd_args.strip()
                    prompt = f"Activate the `{skill.name}` skill with the activate_skill tool, then use it to help with this request."
                    if user_text:
                        prompt = f"{prompt}\n\nUser request:\n{user_text}"
                    if message_id:
                        processed_message_ids.setdefault(convo_id, set()).add(message_id)
                        await ws.send_text(MessageAck(message_id=message_id).model_dump_json())
                        message_id = None
                    await ws.send_text(SkillResult(skill=skill.name, output=f"Queued activation for {skill.name}").model_dump_json())

            is_bash_mode = raw_message.startswith("!") or (isinstance(locals().get("raw_text"), str) and raw_text.startswith("!"))
            bash_command = raw_text[1:] if isinstance(locals().get("raw_text"), str) and raw_text.startswith("!") else ""
            if isinstance(locals().get("raw_text"), str) and raw_text.startswith("!"):
                if not bash_command.strip():
                    await ws.send_text(Error(message="Empty bash command", recoverable=True).model_dump_json())
                    continue

            _invalidate_message_cache()
            await _append_message(
                convo_id,
                _user_event(
                    prompt,
                    message_id=message_id,
                    attachments=attachments or None,
                    bash_mode=bool(isinstance(locals().get("raw_text"), str) and raw_text.startswith("!")),
                ),
            )
            if message_id:
                processed_message_ids.setdefault(convo_id, set()).add(message_id)
                await ws.send_text(MessageAck(message_id=message_id).model_dump_json())

            await _update_conversation_status(convo_id, ConvoStatus.running)

            if isinstance(locals().get("raw_text"), str) and raw_text.startswith("!"):
                target_agents = [None]
                cleaned_prompt = prompt
            elif project_agents:
                target_agents, cleaned_prompt = parse_mentions(prompt, project_agents)
            else:
                target_agents = [None]
                cleaned_prompt = prompt

            file_refs, cleaned_prompt = extract_file_mentions(cleaned_prompt, project_path)
            attachment_lines: list[str] = []
            for attachment in attachments:
                rel_path = str(attachment.get("path", "")).strip()
                if not rel_path:
                    continue
                target = (project_path / rel_path).resolve()
                if not str(target).startswith(str(project_path.resolve())) or not target.is_file():
                    continue
                kind = attachment.get("kind", "file")
                attachment_lines.append(f"[Attached {kind}: {rel_path}]")
            if file_refs or attachment_lines:
                file_context_parts: list[str] = []
                if attachment_lines:
                    file_context_parts.append("\n".join(attachment_lines))
                if file_refs:
                    file_context_parts.append("\n\n".join(f"[File: {path}]\n```\n{content}\n```" for path, content in file_refs))
                cleaned_prompt = f"{'\n\n'.join(file_context_parts)}\n\n{cleaned_prompt}"

            run = RunState(convo_id=convo_id, run_id=_new_run_id())
            run.subscribers.update(session.subscribers)
            session.run = run
            await ws.send_text(Running(run_id=run.run_id).model_dump_json())

            agent_tools.set_workdir(project_path)
            if isinstance(locals().get("raw_text"), str) and raw_text.startswith("!"):
                run.task = asyncio.create_task(_run_bash_command_task(run, bash_command.strip(), convo_id))
                continue
            if _cached_instructions is _UNSET:
                _cached_instructions = await asyncio.to_thread(build_project_instructions, project_path, True)
                _cached_instructions_subsequent = await asyncio.to_thread(build_project_instructions, project_path, False)

            MAX_HANDOFFS = 10
            handoff_count = 0
            current_targets = target_agents
            current_prompt = cleaned_prompt
            is_handoff = False
            run_context = run

            async def _run_with_handoffs():
                nonlocal agent_histories
                _current_targets = current_targets
                _current_prompt = current_prompt
                _is_handoff = is_handoff
                _handoff_count = handoff_count

                while _current_targets and _handoff_count <= MAX_HANDOFFS:
                    _invalidate_message_cache()
                    runs: list[RunState] = []
                    for ac in _current_targets:
                        aid = ac.id if ac else None
                        hist, ctx_tokens = _load_history(aid)

                        if hist and needs_compaction(ctx_tokens):
                            old_tokens = ctx_tokens
                            hist, summary = await compact(hist)
                            if summary:
                                est_tokens = sum(len(str(m)) for m in hist) // 4
                                agent_histories[aid] = (hist, est_tokens)
                                await _append_message(convo_id, _tool_event("compact", event_type="compacted", output=f"{old_tokens / 1000:.1f}k → {est_tokens / 1000:.1f}k tokens (auto)", run_id=run_context.run_id))
                                await _save_agent_history(convo_id, ModelMessagesTypeAdapter.dump_json(hist), agent_id=aid)
                                await run_context.broadcast(Compacted(old_tokens=old_tokens, new_tokens=est_tokens).model_dump_json())

                        is_first_turn = len(hist) == 0
                        instructions = _cached_instructions if is_first_turn else _cached_instructions_subsequent
                        agent_prompt = _current_prompt
                        if ac:
                            _invalidate_message_cache()
                            shared_ctx = _build_shared_context(convo_id, aid, cached_messages=_get_cached_messages())
                            if shared_ctx:
                                if _is_handoff:
                                    agent_prompt = f"[Conversation context]\n{shared_ctx}\n\n[Handoff from another agent]\n{_current_prompt}"
                                else:
                                    agent_prompt = f"[Conversation context]\n{shared_ctx}\n\n[New message from user]\n{_current_prompt}"
                            await run_context.broadcast(AgentStart(run_id=run_context.run_id, agent_id=ac.id, agent_name=ac.name, agent_color=ac.color).model_dump_json())

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
                        return

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

                    if next_targets and _handoff_count < MAX_HANDOFFS:
                        _handoff_count += 1
                        _current_targets = next_targets
                        _current_prompt = "\n".join(next_prompt_parts) if next_prompt_parts else "Continue."
                        _is_handoff = True
                        _invalidate_message_cache()
                        print(f"ws[{convo_id[:8]}]: agent handoff #{_handoff_count} → {[a.id for a in next_targets]}")
                    else:
                        break

                if session.run and session.run.run_id == run.run_id and session.run.status != "running":
                    session.controller = None

            run.task = asyncio.create_task(_run_with_handoffs())

    except WebSocketDisconnect:
        run = session.run
        if run:
            run.subscribers.discard(ws)
            print(f"ws[{convo_id[:8]}]: disconnected, run continues in background")
    finally:
        if session.stt_session is not None:
            try:
                await session.stt_session.stop()
            except Exception:
                pass
            session.stt_session = None
        session.subscribers.discard(ws)
        if session.controller is ws:
            session.controller = None
        run = session.run
        if run:
            run.subscribers.discard(ws)
        if not session.subscribers and session.controller is None and session.run is None:
            sessions.pop(convo_id, None)
        print(f"ws[{convo_id[:8]}]: disconnected (subscribers: {len(session.subscribers)})")
