from __future__ import annotations
from typing import Literal
from pydantic import BaseModel


class AuthOk(BaseModel):
    type: Literal["auth-ok"] = "auth-ok"


class ThinkingDelta(BaseModel):
    type: Literal["thinking-delta"] = "thinking-delta"
    delta: str
    agent_id: str | None = None


class TextDelta(BaseModel):
    type: Literal["text-delta"] = "text-delta"
    delta: str
    agent_id: str | None = None


class ToolUse(BaseModel):
    type: Literal["tool-use"] = "tool-use"
    name: str
    input: dict | str | None = None
    agent_id: str | None = None


class Done(BaseModel):
    type: Literal["done"] = "done"
    cost: float
    turns: int
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


class AgentStart(BaseModel):
    """Signals a specific agent has started processing."""
    type: Literal["agent-start"] = "agent-start"
    agent_id: str
    agent_name: str
    agent_color: str | None = None


class ToolResult(BaseModel):
    """Sent after a tool finishes executing."""
    type: Literal["tool-result"] = "tool-result"
    name: str
    output: str
    agent_id: str | None = None


class Error(BaseModel):
    type: Literal["error"] = "error"
    message: str
    recoverable: bool = False
