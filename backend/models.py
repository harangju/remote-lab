"""Pydantic models for the REST API."""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


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


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    path: Optional[str] = None


class Project(BaseModel):
    id: str
    name: str
    path: str
    created_at: str


# ---------------------------------------------------------------------------
# Conversation models
# ---------------------------------------------------------------------------


class ConvoCreate(BaseModel):
    title: Optional[str] = None


class ConvoMeta(BaseModel):
    id: str
    project_id: str
    title: str
    status: ConvoStatus = ConvoStatus.idle
    created_at: str
    updated_at: str


class ConvoDetail(ConvoMeta):
    """Conversation metadata plus the full message log."""
    messages: list[dict] = Field(default_factory=list)
    context_tokens: int = 0
    context_limit: int = 0
