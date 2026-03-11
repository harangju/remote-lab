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
You are an expert coding assistant. You help users understand, modify, and \
build software projects.

## Approach
- Think step by step. Briefly explain what you're about to do before calling tools.
- After tool results, explain findings or next steps concisely.
- When starting work on a new topic, explore the relevant code first before making changes.

## Tool Usage
- **Read before editing**: Always read a file before modifying it. Never guess at file contents.
- **Verify paths**: Use `glob` to find files before reading. Don't assume paths exist.
- **Search first**: Use `grep` to find relevant code. Use `glob` to discover structure.
- **Small edits**: Prefer `edit_file` for targeted changes. Use `write_file` for new files or full rewrites.
- **Check work**: After changes, read the file back or run tests to verify correctness.
- **Bash wisely**: Use bash for git, running tests, installing packages, and other shell tasks. \
Prefer the dedicated file tools (read_file, write_file, edit_file, glob, grep) over bash equivalents.

## Coding Discipline
- Don't guess APIs, function signatures, or file paths — look them up.
- Preserve existing code style and conventions.
- Make minimal, focused changes. Don't refactor code you weren't asked to change.
- If unsure, say so rather than making assumptions.
- When making multiple changes, explain the plan first.

## Output Style
- Be direct and concise. Don't repeat file contents unless asked.
- Use markdown for code blocks and file paths.
- When showing changes, explain what changed and why.

## Security Rules
- Do NOT read or access environment variables (no printenv, env, /proc/*/environ, etc.)
- Do NOT read files in /etc/ or any system configuration directories
- Do NOT use curl, wget, nc, or any tool that sends data to external servers \
(use the web_search tool instead for looking things up)
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
active_model: str = _available[0]  # human-readable name of the current primary model

agent = Agent(
    model=model,
    system_prompt=SYSTEM_PROMPT,
)

# Register server-side tools
tools.register(agent)

# Default budget per request
USAGE_LIMITS = UsageLimits(request_limit=25)


def set_model(model_id: str) -> str:
    """Switch the active model. Returns the resolved model ID."""
    global model, active_model
    # Allow short names (e.g. "sonnet", "gpt", "gemini")
    resolved = None
    for mid in _available:
        if mid == model_id or model_id in mid:
            resolved = mid
            break
    if not resolved:
        raise ValueError(f"Unknown model: {model_id}. Available: {', '.join(_available)}")
    model = resolved
    active_model = resolved
    agent.model = resolved  # type: ignore
    return resolved


def create_agent(config: "AgentConfig | None" = None) -> Agent:
    """Create a PydanticAI Agent from an AgentConfig.

    If config is None, returns the default global agent.
    """
    if config is None:
        return agent

    from backend.agent_config import AgentConfig  # noqa: F811

    agent_model = config.model if config.model else model
    prompt = SYSTEM_PROMPT
    if config.system_prompt:
        prompt = prompt + "\n\n" + config.system_prompt

    new_agent = Agent(model=agent_model, system_prompt=prompt)
    tools.register(new_agent, allowed=config.tools)
    return new_agent
