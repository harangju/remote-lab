"""PydanticAI agent configuration with multi-provider fallback."""

from __future__ import annotations

from pydantic_ai import Agent
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.usage import UsageLimits

import tools

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

# Multi-provider fallback: try Claude first, then Gemini, then GPT
model = FallbackModel(
    "anthropic:claude-sonnet-4-6",
    "google-gla:gemini-2.5-flash",
    "openai:gpt-5.3-instant",
)

agent = Agent(
    model=model,
    system_prompt=SYSTEM_PROMPT,
)

# Register server-side tools
tools.register(agent)

# Default budget per request
USAGE_LIMITS = UsageLimits(request_limit=25)
