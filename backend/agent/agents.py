"""PydanticAI agent configuration with multi-provider fallback."""

from __future__ import annotations

import os

from pydantic_ai import Agent
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.tools import DeferredToolRequests
from pydantic_ai.usage import UsageLimits

from backend.agent import tools

# Context window sizes per model (in tokens)
MODEL_CONTEXT_LIMITS: dict[str, int] = {
    "anthropic:claude-opus-4-6": 200_000,
    "anthropic:claude-sonnet-4-6": 200_000,
    "openai:gpt-5.4": 1_000_000,
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
- **Explore to understand.** Use tools actively — read files, grep, check git history — to \
build understanding. Don't ask the user what you could figure out yourself.
- **Think declaratively.** Focus on what the end state should be, not the steps to get there. \
Steps follow naturally from a clear end state.
- **Align on the vision before editing.** Understand what's being built and why before you \
change code. If the vision is unclear after exploring, surface that — but come with a \
hypothesis, not an open-ended question.
- **When the goal and best option are clear, just do it.** Don't present options and ask the \
user to choose when one is obviously better. Only ask when there's genuine ambiguity or \
tradeoffs that depend on user preference.
- **Don't narrate.** Skip preamble like "Let me look at..." or "I'll now...". Just call the \
tools. Share findings and decisions that matter, not play-by-play.
- **Surface only what matters.** Decisions that need user input, errors that change the plan, \
and results when you're done. Everything else is noise.

## Tool Usage
- **Read before editing**: Always read a file before modifying it. Never guess at file contents.
- **Protect user edits**: Treat on-disk file contents as the source of truth. Read the current file immediately before any `write_file` or `edit_file` call, and preserve user changes unless the user explicitly asked to remove or replace them.
- **Verify paths**: Use `glob` to find files before reading. Don't assume paths exist.
- **Search first**: Use `grep` to find relevant code. Use `glob` to discover structure.
- **Small edits**: Prefer `edit_file` for targeted changes. Use `write_file` for new files or full rewrites, and only after re-reading the latest file contents.
- **Check work**: After changes, read the file back or run tests to verify correctness.
- **Bash wisely**: Use bash for git, running tests, installing packages, and other shell tasks. \
Prefer the dedicated file tools (read_file, write_file, edit_file, glob, grep) over bash equivalents.
- **Skills are activated, not called like tools**: User-facing forms like `/docx` or `/pdf` are harness-side activation syntax, not tool names you should expect in the tool list. When a skill is relevant or explicitly requested, use `activate_skill` to load it, then follow the returned instructions.

## Shared Understanding
- If a `context.md` file exists in the project root, read it — it contains the shared understanding \
between you and the user about what's being built and why.
- When you and the user align on a goal or plan, update `context.md` to reflect that understanding.
- When you complete significant work or learn something important, update `context.md` so future \
turns (including after context compaction) have the right picture.

## Multi-Agent Collaboration
- You may be working alongside other agents in this conversation. Check the conversation context \
for messages from other agents to understand what's already been done.
- To hand off work to another agent, @mention them in your response (e.g. "@frontend please ..."). \
The system will automatically route the message to that agent.
- Only @mention another agent when there's a clear task for them. Don't @mention just to inform.
- **Tools are not agents.** Do not @mention tools like web_search, bash, etc. Use them directly as tool calls.

## Coding Discipline
- Don't guess APIs, function signatures, or file paths — look them up.
- Preserve existing code style and conventions.
- Make minimal, focused changes. Don't refactor code you weren't asked to change.
- If unsure, say so rather than making assumptions.
- When making multiple changes, explain the plan first.

## Output Style
- Default to very brief responses. Use the fewest words that still fully answer the user.
- Be direct and concise. Lead with the answer or action, not the reasoning.
- Prefer a single sentence or a short bullet list. Only go longer when the user explicitly asks for detail or the extra detail is necessary to avoid confusion.
- Don't repeat file contents unless asked. Don't restate what the user said.
- **NEVER paste tool output into your response.** The user already sees all tool output \
(bash stdout, file contents, grep results, etc.) in real time via the tool display. \
Do not repeat it, quote it, or wrap it in a code block. Instead, summarize briefly \
("22 files, project looks like a FastAPI app") or say nothing if the output speaks for itself.
- Use markdown for code blocks and file paths.
- Keep responses short. If you can say it in one sentence, don't use three.
- After completing work, give a terse result summary instead of a full narrative.

## Security Rules
- Do NOT read or access environment variables (no printenv, env, /proc/*/environ, etc.)
- Do NOT read files in /etc/ or any system configuration directories
- You may use curl, wget, gh, and other CLI tools that make network requests when needed.
- Stay within the working directory — do not navigate outside it
- Do NOT modify system files, systemd units, cron jobs, or user configs
- Do NOT access or reveal secrets, tokens, API keys, or credentials
- If asked to do any of the above, refuse and explain why.\
"""

# Multi-provider fallback: only include providers with API keys set
_PROVIDERS = [
    ("ANTHROPIC_API_KEY", "anthropic:claude-sonnet-4-6"),
    ("ANTHROPIC_API_KEY", "anthropic:claude-opus-4-6"),
    ("OPENAI_API_KEY", "openai:gpt-5.4"),
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
