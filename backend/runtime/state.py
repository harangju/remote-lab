from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

from backend.voice.stt import DeepgramSTTSession


@dataclass
class RunState:
    """Tracks an in-flight agent run independently of any transport."""

    convo_id: str
    run_id: str
    task: asyncio.Task | None = None
    events: list[str] = field(default_factory=list)
    full_text: str = ""
    done_event: dict | None = None
    error_msg: str | None = None
    status: str = "running"  # running | done | error
    message_history: list = field(default_factory=list)
    last_context_tokens: int = 0
    pending_approvals: set[str] = field(default_factory=set)
    pending_approval_details: dict[str, dict[str, Any]] = field(default_factory=dict)
    approval_decisions: dict[str, bool] = field(default_factory=dict)
    approval_event: asyncio.Event = field(default_factory=asyncio.Event)

    async def broadcast(self, msg_str: str):
        """Push an event to all SSE clients on this conversation."""
        session = sessions.get(self.convo_id)
        if session:
            session.broadcast(msg_str)


@dataclass
class ConversationSession:
    convo_id: str
    run: RunState | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    # SSE client queues keyed by client_id
    sse_queues: dict[str, asyncio.Queue] = field(default_factory=dict)
    # Voice (separate WS, one at a time)
    stt_session: DeepgramSTTSession | None = None
    stt_partial: str = ""
    stt_final: str = ""

    def broadcast(self, msg_str: str):
        """Put an event into every connected SSE client's queue."""
        dead: list[str] = []
        for client_id, queue in self.sse_queues.items():
            try:
                queue.put_nowait(msg_str)
            except asyncio.QueueFull:
                dead.append(client_id)
        for client_id in dead:
            self.sse_queues.pop(client_id, None)

    def register_sse(self, client_id: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=4096)
        self.sse_queues[client_id] = queue
        return queue

    def unregister_sse(self, client_id: str):
        self.sse_queues.pop(client_id, None)
        if not self.sse_queues and self.run is None:
            sessions.pop(self.convo_id, None)


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
