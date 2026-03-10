from __future__ import annotations
from typing import Literal, Union
from pydantic import BaseModel


class AuthOk(BaseModel):
    type: Literal["auth-ok"] = "auth-ok"


class TextDelta(BaseModel):
    type: Literal["text-delta"] = "text-delta"
    delta: str


class ToolUse(BaseModel):
    type: Literal["tool-use"] = "tool-use"
    name: str
    input: dict | str | None = None


class ToolResult(BaseModel):
    type: Literal["tool-result"] = "tool-result"
    name: str
    output: str


class Done(BaseModel):
    type: Literal["done"] = "done"
    cost: float
    turns: int


class Error(BaseModel):
    type: Literal["error"] = "error"
    message: str
    recoverable: bool = False


ChatEvent = Union[AuthOk, TextDelta, ToolUse, ToolResult, Done, Error]
