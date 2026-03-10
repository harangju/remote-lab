"""PydanticAI agent configuration with multi-provider fallback."""

from __future__ import annotations

import os

from pydantic_ai import Agent
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.usage import UsageLimits

from backend import tools

SYSTEM_PROMPT = """\
You are a helpful coding assistant. Follow these rules strictly:
- Do NOT read or access environment variables (no printenv, env, /proc/*/environ, etc.)
- Do NOT read files in /etc/ or any system configuration directories
- Do NOT use curl, wget, nc, or any tool that sends data to external servers
- Stay within the working directory — do not navigate outside it
- Do NOT modify system files, systemd units, cron jobs, or user configs
- Do NOT access or reveal secrets, tokens, API keys, or credentials
- If asked to do any of the above, refuse and explain why.\
"""

# Multi-provider fallback: only include providers with API keys set
_PROVIDERS = [
    ("OPENAI_API_KEY", "openai:gpt-5-nano"),
    ("ANTHROPIC_API_KEY", "anthropic:claude-sonnet-4-6"),
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
