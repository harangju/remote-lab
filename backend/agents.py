"""PydanticAI agent configuration with multi-provider fallback."""

from __future__ import annotations

import os

from pydantic_ai import Agent
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.usage import UsageLimits

from backend import tools

# Context window sizes per model (in tokens)
MODEL_CONTEXT_LIMITS: dict[str, int] = {
    "anthropic:claude-sonnet-4-6": 200_000,
    "openai:gpt-5-nano": 128_000,
    "google-gla:gemini-2.5-flash": 1_000_000,
}
# Budget threshold — compact when usage exceeds this fraction
CONTEXT_BUDGET_FRACTION = 0.8


def get_context_limit() -> int:
    """Return the context window size for the active model."""
    if isinstance(model, str):
        return MODEL_CONTEXT_LIMITS.get(model, 128_000)
    # FallbackModel — use the first (preferred) model's limit
    for m in _available:
        if m in MODEL_CONTEXT_LIMITS:
            return MODEL_CONTEXT_LIMITS[m]
    return 128_000

SYSTEM_PROMPT = """\
You are a helpful coding assistant. Think step by step and briefly explain \
what you're about to do before calling tools. After tool results come back, \
continue explaining your findings or next steps.

Follow these rules strictly:
- Do NOT read or access environment variables (no printenv, env, /proc/*/environ, etc.)
- Do NOT read files in /etc/ or any system configuration directories
- Do NOT use curl, wget, nc, or any tool that sends data to external servers (use the web_search tool instead for looking things up)
- Stay within the working directory — do not navigate outside it
- Do NOT modify system files, systemd units, cron jobs, or user configs
- Do NOT access or reveal secrets, tokens, API keys, or credentials
- If asked to do any of the above, refuse and explain why.\
"""

# Multi-provider fallback: only include providers with API keys set
_PROVIDERS = [
    ("ANTHROPIC_API_KEY", "anthropic:claude-sonnet-4-6"),
    ("OPENAI_API_KEY", "openai:gpt-5-nano"),
    ("GOOGLE_API_KEY", "google-gla:gemini-2.5-flash"),
]
_available = [model_id for env_var, model_id in _PROVIDERS if os.environ.get(env_var)]
if not _available:
    raise RuntimeError("No LLM provider API keys found in environment")
model = _available[0] if len(_available) == 1 else FallbackModel(*_available)

agent = Agent(
    model=model,
    system_prompt=SYSTEM_PROMPT,
)

# Register server-side tools
tools.register(agent)

# Default budget per request
USAGE_LIMITS = UsageLimits(request_limit=25)
