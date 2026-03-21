from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import HTTPException
from pydantic_ai import Agent as TitleAgent

from backend.data import storage
from backend.data.models import ConvoStatus
from backend.data.protocol import TitleUpdated
from backend.runtime.state import get_convo_lock, seen_tool_call_ids, sessions


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def append_event(convo_id: str, event: dict) -> None:
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


async def append_message(convo_id: str, event: dict) -> None:
    await append_event(convo_id, event)


def user_event(content: str, message_id: str | None = None, attachments: list[dict[str, Any]] | None = None, *, server_command: bool = False, bash_mode: bool = False) -> dict[str, Any]:
    event: dict[str, Any] = {
        "type": "user-message",
        "role": "user",
        "content": content,
        "timestamp": iso_now(),
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


def parse_tool_content(name: str, raw: Any) -> tuple[str, str | None]:
    if raw is None:
        return "OK", None
    text = str(raw)[:500]
    if name != "edit_file":
        return text, None
    src = raw if isinstance(raw, str) else str(raw)
    try:
        parsed = json.loads(src)
        if isinstance(parsed, dict):
            return str(parsed.get("output") or parsed.get("status") or "OK")[:500], parsed.get("diff")
    except (json.JSONDecodeError, TypeError):
        pass
    return text, None


def tool_event(name: str, *, event_type: str = "tool-result", input: str | None = None, output: str | None = None, diff: str | None = None, run_id: str | None = None, agent_id: str | None = None, tool_call_id: str | None = None) -> dict[str, Any]:
    event: dict[str, Any] = {
        "type": event_type,
        "role": "tool",
        "name": name,
        "timestamp": iso_now(),
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


def system_event(content: str, *, event_type: str = "system", run_id: str | None = None, recoverable: bool | None = None) -> dict[str, Any]:
    event: dict[str, Any] = {
        "type": event_type,
        "content": content,
        "message": content,
        "timestamp": iso_now(),
    }
    if run_id:
        event["run_id"] = run_id
    if recoverable is not None:
        event["recoverable"] = recoverable
    return event


async def update_conversation_status(convo_id: str, status: ConvoStatus) -> None:
    async with get_convo_lock(convo_id):
        storage.update_conversation_status(convo_id, status)


async def save_agent_history(convo_id: str, data: bytes, agent_id: str | None = None) -> None:
    async with get_convo_lock(convo_id):
        storage.save_agent_history(convo_id, data, agent_id=agent_id)


async def update_conversation_autonomy(convo_id: str, enabled: bool) -> None:
    async with get_convo_lock(convo_id):
        storage.update_conversation_autonomy(convo_id, enabled)


async def update_conversation_title(convo_id: str, title: str) -> None:
    async with get_convo_lock(convo_id):
        storage.update_conversation_title(convo_id, title)


async def broadcast_conversation_event(convo_id: str, msg_str: str) -> None:
    session = sessions.get(convo_id)
    if not session:
        return

    dead: set = set()
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


async def auto_title(convo_id: str, user_message: str, available_models: list[str]):
    title_model = None
    for preferred in ("openai:gpt-5.4-nano", "openai:gpt-5-nano", "google-gla:gemini-2.5-flash"):
        if preferred in available_models:
            title_model = preferred
            break
    if not title_model:
        title_model = available_models[0]

    try:
        title_agent = TitleAgent(title_model)
        result = await title_agent.run(
            f"Generate a short title (max 6 words, no quotes) for a conversation that starts with this message:\n\n{user_message[:500]}",
        )
        title = str(result.output).strip().strip('"\'')
        if title:
            await update_conversation_title(convo_id, title)
            await broadcast_conversation_event(convo_id, TitleUpdated(title=title).model_dump_json())
    except Exception as e:
        import logging
        logging.getLogger("remote-lab").warning("Auto-title failed: %s", e, exc_info=True)


def build_shared_context(convo_id: str, agent_id: str | None, max_messages: int = 50, cached_messages: list[dict] | None = None) -> str:
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


def resolve_project_file(project_id: str, path: str) -> tuple[Path, Path]:
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
