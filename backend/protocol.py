from __future__ import annotations
from typing import Literal
from pydantic import BaseModel


class AuthOk(BaseModel):
    type: Literal["auth-ok"] = "auth-ok"


class MessageAck(BaseModel):
    type: Literal["message-ack"] = "message-ack"
    message_id: str


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


class ToolResult(BaseModel):
    """Sent after a tool finishes executing."""
    type: Literal["tool-result"] = "tool-result"
    name: str
    output: str
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
