"""Centralized token estimation for context window management.

Replaces scattered len(str(m)) // 4 heuristics with per-content-type
ratios that better approximate actual tokenizer behavior.
"""

from __future__ import annotations

from pydantic_ai.messages import (
    BinaryContent,
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    ThinkingPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)

# Ratios: characters per token (higher = fewer tokens per char)
_TEXT_RATIO = 3.5       # prose / code
_JSON_RATIO = 3.2       # JSON args tend to be token-dense
_BINARY_FIXED = 1000    # fixed estimate per binary attachment
_MSG_OVERHEAD = 20      # structural tokens per message (role, framing)
_PART_OVERHEAD = 5      # structural tokens per part within a message


def _estimate_str_tokens(text: str, ratio: float = _TEXT_RATIO) -> int:
    return int(len(text) / ratio) if text else 0


def estimate_part_tokens(part) -> int:
    """Estimate tokens for a single message part."""
    if isinstance(part, UserPromptPart):
        if isinstance(part.content, str):
            return _estimate_str_tokens(part.content) + _PART_OVERHEAD
        # Multimodal content list
        total = _PART_OVERHEAD
        for item in part.content:
            if isinstance(item, str):
                total += _estimate_str_tokens(item)
            elif isinstance(item, BinaryContent):
                total += _BINARY_FIXED
            else:
                total += _estimate_str_tokens(str(item))
        return total
    elif isinstance(part, TextPart):
        return _estimate_str_tokens(part.content) + _PART_OVERHEAD
    elif isinstance(part, ThinkingPart):
        # Thinking content is sent back but typically not in context window
        # for subsequent turns — estimate conservatively
        return _estimate_str_tokens(part.content) + _PART_OVERHEAD
    elif isinstance(part, ToolCallPart):
        args_str = str(part.args) if part.args else ""
        return _estimate_str_tokens(args_str, _JSON_RATIO) + _PART_OVERHEAD
    elif isinstance(part, ToolReturnPart):
        content_str = str(part.content) if part.content else ""
        return _estimate_str_tokens(content_str) + _PART_OVERHEAD
    else:
        return _estimate_str_tokens(str(part)) + _PART_OVERHEAD


def estimate_message_tokens(msg: ModelMessage) -> int:
    """Estimate token count for a single PydanticAI message."""
    total = _MSG_OVERHEAD
    if isinstance(msg, (ModelRequest, ModelResponse)):
        for part in msg.parts:
            total += estimate_part_tokens(part)
    return total


def estimate_history_tokens(messages: list[ModelMessage]) -> int:
    """Estimate total token count for a message history."""
    return sum(estimate_message_tokens(m) for m in messages)


def content_byte_size(part: ToolReturnPart) -> int:
    """Get byte size of a tool return's content."""
    if part.content is None:
        return 0
    s = str(part.content)
    return len(s.encode("utf-8", errors="replace"))
