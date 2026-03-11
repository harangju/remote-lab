from __future__ import annotations
from typing import Literal
from pydantic import BaseModel


class AuthOk(BaseModel):
    type: Literal["auth-ok"] = "auth-ok"


class ThinkingDelta(BaseModel):
    type: Literal["thinking-delta"] = "thinking-delta"
    delta: str


class TextDelta(BaseModel):
    type: Literal["text-delta"] = "text-delta"
    delta: str


class ToolUse(BaseModel):
    type: Literal["tool-use"] = "tool-use"
    name: str
    input: dict | str | None = None


class Done(BaseModel):
    type: Literal["done"] = "done"
    cost: float
    turns: int
    context_tokens: int = 0
    context_limit: int = 0


class Compacted(BaseModel):
    type: Literal["compacted"] = "compacted"
    old_tokens: int
    new_tokens: int


class Running(BaseModel):
    """Sent when a client connects to a conversation with an in-flight agent run."""
    type: Literal["running"] = "running"


class Error(BaseModel):
    type: Literal["error"] = "error"
    message: str
    recoverable: bool = False
