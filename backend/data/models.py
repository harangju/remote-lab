"""Pydantic models for the REST API."""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class Attachment(BaseModel):
    path: str
    name: str
    mime_type: str
    size: int
    kind: str


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class ConvoStatus(str, Enum):
    idle = "idle"
    running = "running"
    done = "done"
    error = "error"


# ---------------------------------------------------------------------------
# Project models
# ---------------------------------------------------------------------------


class ProjectCreate(BaseModel):
    name: str
    path: str
    github_url: Optional[str] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    path: Optional[str] = None
    archived_at: Optional[str] = None


class Project(BaseModel):
    id: str
    name: str
    path: str
    created_at: str
    updated_at: str
    archived_at: Optional[str] = None


# ---------------------------------------------------------------------------
# Conversation models
# ---------------------------------------------------------------------------


class ConvoCreate(BaseModel):
    title: Optional[str] = None


class ConvoUpdate(BaseModel):
    title: Optional[str] = None
    archived_at: Optional[str] = None
    autonomous_tools_enabled: Optional[bool] = None


class ConvoMeta(BaseModel):
    id: str
    project_id: str
    title: str
    status: ConvoStatus = ConvoStatus.idle
    created_at: str
    updated_at: str
    last_event_at: Optional[str] = None
    archived_at: Optional[str] = None
    autonomous_tools_enabled: bool = False


class ConvoDetail(ConvoMeta):
    """Conversation metadata plus a window into the message log."""
    messages: list[dict] = Field(default_factory=list)
    context_tokens: int = 0
    context_limit: int = 0
    has_more: bool = False
    next_before: int | None = None


class UploadResult(Attachment):
    pass
