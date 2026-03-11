"""Per-project agent configuration models."""

from __future__ import annotations

from pydantic import BaseModel


class AgentConfig(BaseModel):
    """Configuration for a named agent within a project."""
    id: str                          # e.g. "coder", "reviewer"
    name: str                        # Display name
    model: str | None = None         # Override model, e.g. "anthropic:claude-sonnet-4-6"
    system_prompt: str | None = None # Additional system prompt (appended to base)
    tools: list[str] | None = None   # Tool whitelist; None = all tools
    color: str | None = None         # Display color hex, e.g. "#4d9375"
    is_default: bool = False         # Used when no @mention
