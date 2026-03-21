"""FastAPI server: WebSocket chat UI, REST API, agent runner."""

from __future__ import annotations

import asyncio
import hmac
import json
import os
from typing import Any
from datetime import datetime, timezone
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
from backend.runtime.runner import build_multimodal_prompt, run_agent_task, run_bash_command_task


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


async def _append_event(convo_id: str, event: dict) -> None:
    event_type = str(event.get("type", ""))
    if event_type == "tool-call":
        tool_call_id = str(event.get("tool_call_id", ""))
        if tool_call_id:
            seen = seen_tool_call_ids(convo_id)
            if tool_call_id in seen:
                return
            seen.add(tool_call_id)
    async with get_convo_lock(convo_id):
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


def _parse_tool_content(name: str, raw: Any) -> tuple[str, str | None]:
    """Extract (output, diff) from a tool result.

    For edit_file the tool returns a JSON string with {output, diff}.
    For everything else just stringify the content.
    """
    if raw is None:
        return "OK", None
    text = str(raw)[:500]
    if name != "edit_file":
        return text, None
    # edit_file returns json.dumps({"output": ..., "diff": ...})
    src = raw if isinstance(raw, str) else str(raw)
    try:
        parsed = json.loads(src)
        if isinstance(parsed, dict):
            return str(parsed.get("output") or parsed.get("status") or "OK")[:500], parsed.get("diff")
    except (json.JSONDecodeError, TypeError):
        pass
    return text, None


def _tool_event(name: str, *, event_type: str = "tool-result", input: str | None = None, output: str | None = None, diff: str | None = None, run_id: str | None = None, agent_id: str | None = None, tool_call_id: str | None = None) -> dict[str, Any]:
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
    if diff is not None:
        event["diff"] = diff
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
    async with get_convo_lock(convo_id):
        storage.update_conversation_status(convo_id, status)


async def _save_agent_history(convo_id: str, data: bytes, agent_id: str | None = None) -> None:
    async with get_convo_lock(convo_id):
        storage.save_agent_history(convo_id, data, agent_id=agent_id)


async def _update_conversation_autonomy(convo_id: str, enabled: bool) -> None:
    async with get_convo_lock(convo_id):
        storage.update_conversation_autonomy(convo_id, enabled)


async def _update_conversation_title(convo_id: str, title: str) -> None:
    async with get_convo_lock(convo_id):
        storage.update_conversation_title(convo_id, title)


async def _broadcast_conversation_event(convo_id: str, msg_str: str) -> None:
    session = sessions.get(convo_id)
    if not session:
        return

    dead: set[WebSocket] = set()
    for ws in session.subscribers:
        try:
            await ws.send_text(msg_str)
        except Exception:
            dead.add(ws)
    session.subscribers -= dead

    run = session.run
    if run is not None:
        run.subscribers -= dead
        run.events.append(msg_str)


async def _auto_title(convo_id: str, user_message: str):
    from pydantic_ai import Agent as _Agent
    from backend.agent.agents import _available

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
            await _broadcast_conversation_event(convo_id, TitleUpdated(title=title).model_dump_json())
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

        if convo.status == ConvoStatus.running and session.run is None:
            await _update_conversation_status(convo_id, ConvoStatus.error)
            restart_event = _system_event("Server restarted during run", event_type="run-error", recoverable=True)
            await _append_event(convo_id, restart_event)
            await ws.send_text(json.dumps(restart_event | {"type": "error"}))
            convo = storage.get_conversation(convo_id)

        project_agents = storage.load_project_agents(project.id)
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
                        from backend.agent.agents import active_model, _available, set_model
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
                        output = await handle_share(cmd_args, project_path, ws, PUBLIC_DIR, PUBLIC_BASE_URL)
                        await _append_message(convo_id, _tool_event("share", event_type="skill-result", output=output))
                        if message_id:
                            processed_message_ids.setdefault(convo_id, set()).add(message_id)
                            await ws.send_text(MessageAck(message_id=message_id).model_dump_json())
                        await ws.send_text(SkillResult(skill="share", output=output).model_dump_json())
                    elif skill.name == "shares":
                        await _append_message(convo_id, _user_event(prompt, message_id=message_id, server_command=True))
                        _invalidate_message_cache()
                        output = await handle_shares(ws, PUBLIC_DIR, PUBLIC_BASE_URL)
                        await _append_message(convo_id, _tool_event("shares", event_type="skill-result", output=output))
                        if message_id:
                            processed_message_ids.setdefault(convo_id, set()).add(message_id)
                            await ws.send_text(MessageAck(message_id=message_id).model_dump_json())
                        await ws.send_text(SkillResult(skill="shares", output=output).model_dump_json())
                    elif skill.name == "unshare":
                        await _append_message(convo_id, _user_event(prompt, message_id=message_id, server_command=True))
                        _invalidate_message_cache()
                        output = await handle_unshare(cmd_args, PUBLIC_DIR)
                        await _append_message(convo_id, _tool_event("unshare", event_type="skill-result", output=output))
                        if message_id:
                            processed_message_ids.setdefault(convo_id, set()).add(message_id)
                            await ws.send_text(MessageAck(message_id=message_id).model_dump_json())
                        await ws.send_text(SkillResult(skill="unshare", output=output).model_dump_json())
                    continue
                elif skill and skill.type == SkillType.prompt:
                    user_text = cmd_args.strip()
                    prompt = (
                        f"Activate the `{skill.name}` skill with the activate_skill tool, then use it to help with this request. "
                        "Before changing any existing file, read the current file immediately before editing and preserve any user edits unless the user explicitly asked to remove them."
                    )
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

            current_meta = storage._read_meta(convo_id)
            if current_meta and current_meta.title == "Untitled":
                asyncio.create_task(_auto_title(convo_id, prompt))

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
            non_image_attachment_lines: list[str] = []
            for attachment in attachments:
                rel_path = str(attachment.get("path", "")).strip()
                if not rel_path:
                    continue
                target = (project_path / rel_path).resolve()
                if not str(target).startswith(str(project_path.resolve())) or not target.is_file():
                    continue
                kind = attachment.get("kind", "file")
                if kind != "image":
                    non_image_attachment_lines.append(f"[Attached {kind}: {rel_path}]")
            if file_refs or non_image_attachment_lines:
                file_context_parts: list[str] = []
                if non_image_attachment_lines:
                    file_context_parts.append("\n".join(non_image_attachment_lines))
                if file_refs:
                    file_context_parts.append("\n\n".join(f"[File: {path}]\n```\n{content}\n```" for path, content in file_refs))
                cleaned_prompt = f"{'\n\n'.join(file_context_parts)}\n\n{cleaned_prompt}"

            agent_prompt = build_multimodal_prompt(cleaned_prompt, attachments, project_path)

            run = RunState(convo_id=convo_id, run_id=_new_run_id())
            run.subscribers.update(session.subscribers)
            session.run = run
            await ws.send_text(Running(run_id=run.run_id).model_dump_json())

            agent_tools.set_workdir(project_path)
            if isinstance(locals().get("raw_text"), str) and raw_text.startswith("!"):
                run.task = asyncio.create_task(run_bash_command_task(
                    run,
                    bash_command.strip(),
                    convo_id,
                    iso_now=_iso_now,
                    append_event=_append_event,
                    append_message=_append_message,
                    update_conversation_status=_update_conversation_status,
                    system_event=_system_event,
                    get_workdir=get_workdir,
                ))
                continue
            if _cached_instructions is _UNSET:
                _cached_instructions = await asyncio.to_thread(build_project_instructions, project_path, True)
                _cached_instructions_subsequent = await asyncio.to_thread(build_project_instructions, project_path, False)

            MAX_HANDOFFS = 10
            handoff_count = 0
            current_targets = target_agents
            current_prompt: str | list[UserContent] = agent_prompt
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
                                if isinstance(agent_prompt, list):
                                    user_text = next((item for item in agent_prompt if isinstance(item, str)), "")
                                    prefix = "[Handoff from another agent]" if _is_handoff else "[New message from user]"
                                    agent_prompt = [
                                        f"[Conversation context]\n{shared_ctx}\n\n{prefix}\n{user_text}",
                                        *[item for item in agent_prompt if not isinstance(item, str)],
                                    ]
                                else:
                                    if _is_handoff:
                                        agent_prompt = f"[Conversation context]\n{shared_ctx}\n\n[Handoff from another agent]\n{agent_prompt}"
                                    else:
                                        agent_prompt = f"[Conversation context]\n{shared_ctx}\n\n[New message from user]\n{agent_prompt}"
                            await run_context.broadcast(AgentStart(run_id=run_context.run_id, agent_id=ac.id, agent_name=ac.name, agent_color=ac.color).model_dump_json())

                        agent_instance = _agent_cache.get(ac.id if ac else None) or create_agent(ac)
                        _agent_cache[ac.id if ac else None] = agent_instance

                        agent_run = RunState(convo_id=convo_id, run_id=run_context.run_id, message_history=list(hist))
                        agent_run.subscribers.update(session.subscribers)
                        session.run = agent_run
                        agent_run.task = asyncio.create_task(
                            run_agent_task(
                                agent_run,
                                agent_prompt,
                                hist,
                                convo_id,
                                instructions=instructions,
                                agent_instance=agent_instance,
                                agent_id=aid,
                                iso_now=_iso_now,
                                append_event=_append_event,
                                append_message=_append_message,
                                update_conversation_status=_update_conversation_status,
                                save_agent_history=_save_agent_history,
                                system_event=_system_event,
                                parse_tool_content=_parse_tool_content,
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
