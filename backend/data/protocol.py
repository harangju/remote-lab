from __future__ import annotations
from typing import Literal
from pydantic import BaseModel


class Sync(BaseModel):
    """Sent after auth-ok + any active-run replay to signal the client
    that the connection handshake is complete.  ``running`` is True when
    a run was already in-flight and the server replayed buffered events."""
    type: Literal["sync"] = "sync"
    running: bool = False


class ThinkingDelta(BaseModel):
    type: Literal["thinking-delta"] = "thinking-delta"
    delta: str
    run_id: str
    agent_id: str | None = None


class TextDelta(BaseModel):
    type: Literal["text-delta"] = "text-delta"
    delta: str
    run_id: str
    agent_id: str | None = None


class ToolUse(BaseModel):
    type: Literal["tool-use"] = "tool-use"
    name: str
    input: dict | str | None = None
    run_id: str
    agent_id: str | None = None


class Done(BaseModel):
    type: Literal["done"] = "done"
    turns: int
    run_id: str
    context_tokens: int = 0
    context_limit: int = 0
    agent_id: str | None = None
    status: Literal["ok", "cancelled", "error"] = "ok"
    error_message: str | None = None


class Compacted(BaseModel):
    type: Literal["compacted"] = "compacted"
    old_tokens: int
    new_tokens: int


class Running(BaseModel):
    """Sent when a client connects to a conversation with an in-flight agent run."""
    type: Literal["running"] = "running"
    run_id: str


class AgentStart(BaseModel):
    """Signals a specific agent has started processing."""
    type: Literal["agent-start"] = "agent-start"
    run_id: str
    agent_id: str
    agent_name: str
    agent_color: str | None = None
    agent_model: str | None = None


class ToolResult(BaseModel):
    """Sent after a tool finishes executing."""
    type: Literal["tool-result"] = "tool-result"
    name: str
    output: str
    diff: str | None = None
    run_id: str
    agent_id: str | None = None


class ToolOutput(BaseModel):
    """Incremental output from a running tool (e.g., bash stdout chunks)."""
    type: Literal["tool-output"] = "tool-output"
    name: str
    output: str
    run_id: str
    agent_id: str | None = None


class FileChanged(BaseModel):
    """Sent when a file is created or updated on disk."""
    type: Literal["file-changed"] = "file-changed"
    path: str
    change: Literal["created", "updated"]
    run_id: str
    agent_id: str | None = None


class SkillResult(BaseModel):
    """Sent after a server-side skill finishes executing."""
    type: Literal["skill-result"] = "skill-result"
    skill: str
    output: str


class ToolConfirm(BaseModel):
    """Sent when a tool requires user approval before execution."""
    type: Literal["tool-confirm"] = "tool-confirm"
    tool_call_id: str
    name: str
    run_id: str
    args: dict | str | None = None
    agent_id: str | None = None
    can_allow_project: bool = True
    can_turn_on_auto: bool = True


class TitleUpdated(BaseModel):
    type: Literal["title-updated"] = "title-updated"
    title: str


class VoiceState(BaseModel):
    type: Literal["voice-state"] = "voice-state"
    state: Literal["starting", "listening", "stopped"]


class VoiceTranscript(BaseModel):
    type: Literal["voice-transcript"] = "voice-transcript"
    text: str
    is_final: bool = False


class Error(BaseModel):
    type: Literal["error"] = "error"
    message: str
    run_id: str | None = None
    recoverable: bool = False
