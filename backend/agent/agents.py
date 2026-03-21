"""PydanticAI agent configuration with multi-provider fallback."""

from __future__ import annotations

import os
from pathlib import Path

from pydantic_ai import Agent
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.tools import DeferredToolRequests
from pydantic_ai.usage import UsageLimits

from backend.agent import tools

# Context window sizes per model (in tokens)
MODEL_CONTEXT_LIMITS: dict[str, int] = {
    "anthropic:claude-opus-4-6": 200_000,
    "anthropic:claude-sonnet-4-6": 200_000,
    "openai:gpt-5.4": 1_050_000,
    "openai:gpt-5.4-pro": 1_050_000,
    "openai:gpt-5.4-mini": 400_000,
    "openai:gpt-5.4-nano": 400_000,
    "openai:gpt-5-nano": 128_000,
    "google-gla:gemini-2.5-flash": 1_000_000,
}
# Budget threshold — compact when usage exceeds this fraction.
CONTEXT_BUDGET_FRACTION = 0.8
# Soft compaction thresholds for expensive models.
PRICE_TIER_INPUT_LIMITS: dict[str, int] = {
    "openai:gpt-5.4": 272_000,
    "openai:gpt-5.4-pro": 272_000,
}


def get_context_limit() -> int:
    """Return the context window size for the active model."""
    if isinstance(model, str):
        return MODEL_CONTEXT_LIMITS.get(model, 128_000)
    # FallbackModel — use the first (preferred) model's limit
    for m in _available:
        if m in MODEL_CONTEXT_LIMITS:
            return MODEL_CONTEXT_LIMITS[m]
    return 128_000

_PROMPT_FILE = Path(__file__).parent / "SYSTEM_PROMPT.md"


def _load_system_prompt() -> str:
    return _PROMPT_FILE.read_text().strip()


SYSTEM_PROMPT = _load_system_prompt()

# Multi-provider fallback: only include providers with API keys set
_PROVIDERS = [
    ("ANTHROPIC_API_KEY", "anthropic:claude-sonnet-4-6"),
    ("ANTHROPIC_API_KEY", "anthropic:claude-opus-4-6"),
    ("OPENAI_API_KEY", "openai:gpt-5.4"),
    ("OPENAI_API_KEY", "openai:gpt-5.4-mini"),
    ("OPENAI_API_KEY", "openai:gpt-5.4-nano"),
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
    output_type=[str, DeferredToolRequests],
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

    from backend.agent.agent_config import AgentConfig  # noqa: F811

    agent_model = config.model if config.model else model
    prompt = SYSTEM_PROMPT
    if config.system_prompt:
        prompt = prompt + "\n\n" + config.system_prompt

    new_agent = Agent(model=agent_model, system_prompt=prompt, output_type=[str, DeferredToolRequests])
    tools.register(new_agent, allowed=config.tools)
    return new_agent
