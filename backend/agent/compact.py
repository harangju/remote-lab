"""Context window compaction via summarization."""

from __future__ import annotations

from pydantic_ai import Agent
from pydantic_ai.messages import (
    BinaryContent,
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    UserPromptPart,
    ToolCallPart,
    ToolReturnPart,
)

from backend.agent.agents import agent, CONTEXT_BUDGET_FRACTION, get_context_limit

# Number of recent request/response pairs to keep intact
KEEP_RECENT_TURNS = 3

SUMMARIZE_PROMPT = """\
Summarize the following conversation between a user and an AI coding assistant. \
Preserve key decisions, file paths, code changes, and any important context the \
assistant would need to continue helping. Be concise but thorough — this summary \
will replace the original messages in the conversation history.

Conversation:
{conversation}
"""

# Lightweight agent just for summarization (reuses the same model)
_summarizer = Agent(
    model=agent.model,
    system_prompt="You are a conversation summarizer. Output a concise summary only.",
)


def _extract_text(messages: list[ModelMessage]) -> str:
    """Convert message history into a readable text for summarization."""
    lines: list[str] = []
    for msg in messages:
        if isinstance(msg, ModelRequest):
            for part in msg.parts:
                if isinstance(part, UserPromptPart):
                    if isinstance(part.content, str):
                        lines.append(f"User: {part.content}")
                    else:
                        rendered: list[str] = []
                        for item in part.content:
                            if isinstance(item, str):
                                rendered.append(item)
                            elif isinstance(item, BinaryContent):
                                rendered.append(f"[binary attachment: {item.media_type} {item.identifier or ''}]".strip())
                            else:
                                rendered.append(str(item))
                        lines.append(f"User: {' '.join(rendered)}")
                elif isinstance(part, ToolReturnPart):
                    content = str(part.content)[:200]
                    lines.append(f"Tool result ({part.tool_name}): {content}")
        elif isinstance(msg, ModelResponse):
            for part in msg.parts:
                if isinstance(part, TextPart):
                    lines.append(f"Assistant: {part.content}")
                elif isinstance(part, ToolCallPart):
                    args = str(part.args)[:100]
                    lines.append(f"Tool call: {part.tool_name}({args})")
    return "\n".join(lines)


def needs_compaction(context_tokens: int) -> bool:
    """Check if context usage exceeds the budget threshold."""
    limit = get_context_limit()
    return context_tokens > int(limit * CONTEXT_BUDGET_FRACTION)


async def compact(messages: list[ModelMessage]) -> tuple[list[ModelMessage], str]:
    """Compact message history by summarizing older messages.

    Returns (new_messages, summary_text).
    Keeps the last KEEP_RECENT_TURNS request/response pairs intact.
    """
    if len(messages) < KEEP_RECENT_TURNS * 2 + 2:
        # Not enough messages to compact
        return messages, ""

    # Split: old messages to summarize, recent messages to keep
    # Count from the end: each "turn" is roughly a ModelRequest + ModelResponse pair
    recent_count = 0
    split_idx = len(messages)
    for i in range(len(messages) - 1, -1, -1):
        if isinstance(messages[i], ModelResponse):
            recent_count += 1
            if recent_count >= KEEP_RECENT_TURNS:
                split_idx = i
                break

    old_messages = messages[:split_idx]
    recent_messages = messages[split_idx:]

    if not old_messages:
        return messages, ""

    # Summarize the old messages
    conversation_text = _extract_text(old_messages)
    prompt = SUMMARIZE_PROMPT.format(conversation=conversation_text)

    result = await _summarizer.run(prompt)
    summary = result.output

    # Build new history: summary as a "previous context" message + recent messages
    summary_request = ModelRequest.user_text_prompt(
        f"[Previous conversation summary]\n{summary}"
    )
    new_messages = [summary_request] + list(recent_messages)

    return new_messages, summary
