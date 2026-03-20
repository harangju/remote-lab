from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket

from backend.voice.stt import DeepgramSTTSession


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
_seen_tool_call_ids: dict[str, set[str]] = {}


def get_session(convo_id: str) -> ConversationSession:
    session = sessions.get(convo_id)
    if session is None:
        session = ConversationSession(convo_id=convo_id)
        sessions[convo_id] = session
    return session


def get_convo_lock(convo_id: str) -> asyncio.Lock:
    lock = convo_locks.get(convo_id)
    if lock is None:
        lock = asyncio.Lock()
        convo_locks[convo_id] = lock
    return lock


def seen_tool_call_ids(convo_id: str) -> set[str]:
    return _seen_tool_call_ids.setdefault(convo_id, set())
