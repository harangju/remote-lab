"""Multi-layer context window management pipeline.

Progressively manages context usage through three layers:
  Layer 1 (>=50%): Trim old tool results to structured summaries (free)
  Layer 2 (>=70%): Summarize old conversation turns in chunks (LLM call)
  Layer 3 (>=85%): Full compaction — summarize all old messages (LLM call)
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Sequence

from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
)

from backend.agent.token_estimate import (
    content_byte_size,
    estimate_history_tokens,
)

# ---------------------------------------------------------------------------
# Thresholds (fraction of context budget)
# ---------------------------------------------------------------------------
TRIM_THRESHOLD = 0.50       # Layer 1: trim old tool results
SUMMARIZE_THRESHOLD = 0.70  # Layer 2: chunk-summarize old turns
COMPACT_THRESHOLD = 0.85    # Layer 3: full compaction (existing)

# How many recent turns to always keep intact
KEEP_RECENT_TURNS = 3

# Tool result size thresholds (bytes)
SMALL_RESULT = 1_000        # keep as-is
MEDIUM_RESULT = 5_000       # truncate head+tail
# above MEDIUM_RESULT: replace with structured summary


@dataclass
class ContextResult:
    """Result of running the context management pipeline."""
    messages: list[ModelMessage]
    estimated_tokens: int
    actions_taken: list[str] = field(default_factory=list)
    tokens_saved: int = 0


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def manage_context(
    messages: list[ModelMessage],
    context_tokens: int,
    model_id: str | None = None,
) -> ContextResult:
    """Run the progressive context management pipeline.

    Called before each agent run. Applies layers based on context usage.
    """
    from backend.agent.agents import PRICE_TIER_INPUT_LIMITS, get_context_limit, CONTEXT_BUDGET_FRACTION

    mid = model_id or "unknown"
    raw_limit = get_context_limit(mid)
    soft_limit = PRICE_TIER_INPUT_LIMITS.get(mid, raw_limit)
    budget = min(soft_limit, int(raw_limit * CONTEXT_BUDGET_FRACTION))

    if budget <= 0 or context_tokens <= 0:
        return ContextResult(messages=messages, estimated_tokens=context_tokens)

    usage = context_tokens / budget
    result = ContextResult(messages=list(messages), estimated_tokens=context_tokens)

    # Layer 1: Trim old tool results (free, no LLM)
    if usage >= TRIM_THRESHOLD:
        trimmed, saved = _trim_tool_results(result.messages, KEEP_RECENT_TURNS)
        if saved > 0:
            result.messages = trimmed
            result.estimated_tokens = estimate_history_tokens(trimmed)
            result.tokens_saved += saved
            result.actions_taken.append(f"trimmed old tool results (~{saved:,} tokens)")
            usage = result.estimated_tokens / budget

    # Layer 2: Chunk-summarize old turns (LLM calls)
    if usage >= SUMMARIZE_THRESHOLD:
        summarized, saved = await _summarize_old_turns(result.messages, keep_recent=5)
        if saved > 0:
            result.messages = summarized
            result.estimated_tokens = estimate_history_tokens(summarized)
            result.tokens_saved += saved
            result.actions_taken.append(f"summarized old turns (~{saved:,} tokens)")
            usage = result.estimated_tokens / budget

    # Layer 3: Full compaction (existing behavior)
    if usage >= COMPACT_THRESHOLD:
        from backend.agent.compact import compact
        compacted, summary = await compact(result.messages)
        if summary:
            old_est = result.estimated_tokens
            result.messages = compacted
            result.estimated_tokens = estimate_history_tokens(compacted)
            saved = old_est - result.estimated_tokens
            result.tokens_saved += max(saved, 0)
            result.actions_taken.append(f"full compaction (~{max(saved, 0):,} tokens)")

    return result


# ---------------------------------------------------------------------------
# Layer 1: Tool Result Trimming
# ---------------------------------------------------------------------------

def _split_at_recent(messages: list[ModelMessage], keep_recent: int) -> int:
    """Return the index where 'old' messages end and 'recent' begin.

    Counts ModelResponse objects that contain TextPart (final responses)
    from the end, then walks backward to include the full tool-call cycle
    that belongs to that turn.
    """
    count = 0
    split = len(messages)
    for i in range(len(messages) - 1, -1, -1):
        if isinstance(messages[i], ModelResponse):
            # Only count responses with text as "turn boundaries"
            # (tool-call-only responses are mid-turn)
            has_text = any(isinstance(p, TextPart) for p in messages[i].parts)
            if has_text:
                count += 1
                if count >= keep_recent:
                    split = i
                    break

    # Walk backward from split to include any preceding tool call/return
    # that belongs to this turn (ModelRequest with ToolReturnPart, then
    # ModelResponse with ToolCallPart)
    while split > 0:
        prev = messages[split - 1]
        if isinstance(prev, ModelRequest) and any(
            isinstance(p, ToolReturnPart) for p in prev.parts
        ):
            split -= 1
        elif isinstance(prev, ModelResponse) and any(
            isinstance(p, ToolCallPart) for p in prev.parts
        ):
            split -= 1
        else:
            break

    return split


def _find_tool_args(messages: list[ModelMessage], tool_call_id: str) -> str | None:
    """Find the args for a tool call by its ID (to extract path, command, etc.)."""
    for msg in messages:
        if isinstance(msg, ModelResponse):
            for part in msg.parts:
                if isinstance(part, ToolCallPart) and part.tool_call_id == tool_call_id:
                    return str(part.args) if part.args else None
    return None


def _summarize_read_file(content: str, args_str: str | None) -> str:
    """Create a structured summary of a read_file result."""
    path = ""
    if args_str:
        # args is typically {"path": "..."} or just "..."
        m = re.search(r'"path"\s*:\s*"([^"]+)"', args_str)
        if m:
            path = m.group(1)
        elif not path:
            path = args_str.strip('"').strip("'").strip()

    lines = content.splitlines()
    line_count = len(lines)

    # Detect language from extension
    lang = ""
    if path:
        ext = path.rsplit(".", 1)[-1] if "." in path else ""
        lang_map = {
            "py": "Python", "js": "JavaScript", "ts": "TypeScript",
            "tsx": "TypeScript/React", "jsx": "JavaScript/React",
            "rs": "Rust", "go": "Go", "java": "Java", "rb": "Ruby",
            "sh": "Shell", "md": "Markdown", "json": "JSON",
            "yaml": "YAML", "yml": "YAML", "toml": "TOML",
            "css": "CSS", "html": "HTML", "sql": "SQL",
        }
        lang = lang_map.get(ext, ext.upper() if ext else "")

    # Extract top-level definitions (Python-style as most common)
    defs: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith(("def ", "async def ")):
            name = stripped.split("(")[0].replace("async ", "").replace("def ", "")
            defs.append(name)
        elif stripped.startswith("class "):
            name = stripped.split("(")[0].split(":")[0].replace("class ", "")
            defs.append(f"class {name}")
        elif stripped.startswith(("export ", "function ")):
            # JS/TS
            m = re.match(r"(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)", stripped)
            if m:
                defs.append(m.group(1))
        elif stripped.startswith(("const ", "let ", "var ")) and "=>" in stripped:
            m = re.match(r"(?:export\s+)?(?:const|let|var)\s+(\w+)", stripped)
            if m:
                defs.append(m.group(1))

    lang_str = f", {lang}" if lang else ""
    defs_str = f". Defines: {', '.join(defs[:15])}" if defs else ""
    return f"[Previously read {path}: {line_count} lines{lang_str}{defs_str}]"


def _summarize_bash(content: str, args_str: str | None) -> str:
    """Create a structured summary of a bash result."""
    command = ""
    if args_str:
        m = re.search(r'"command"\s*:\s*"([^"]*)"', args_str)
        if m:
            command = m.group(1)

    lines = content.splitlines()
    line_count = len(lines)

    # Extract exit code
    exit_code = "?"
    if lines and lines[0].startswith("exit "):
        exit_code = lines[0].split(" ", 1)[1].strip()
        lines = lines[1:]

    first_line = lines[0].strip()[:100] if lines else ""
    last_line = lines[-1].strip()[:100] if len(lines) > 1 else ""

    cmd_str = f" `{command[:80]}`" if command else ""
    summary = f"[bash{cmd_str}: exit {exit_code}, {line_count} lines"
    if first_line:
        summary += f". First: {first_line}"
    if last_line and last_line != first_line:
        summary += f". Last: {last_line}"
    return summary + "]"


def _summarize_grep(content: str, args_str: str | None) -> str:
    """Create a structured summary of a grep result."""
    pattern = ""
    if args_str:
        m = re.search(r'"pattern"\s*:\s*"([^"]*)"', args_str)
        if m:
            pattern = m.group(1)

    lines = content.strip().splitlines()
    match_count = len(lines)
    files: set[str] = set()
    for line in lines:
        if ":" in line:
            files.add(line.split(":")[0])

    pat_str = f" `{pattern[:60]}`" if pattern else ""
    return f"[grep{pat_str}: {match_count} matches in {len(files)} files]"


def _summarize_glob(content: str, args_str: str | None) -> str:
    """Create a structured summary of a glob result."""
    pattern = ""
    if args_str:
        m = re.search(r'"pattern"\s*:\s*"([^"]*)"', args_str)
        if m:
            pattern = m.group(1)

    lines = [l for l in content.strip().splitlines() if l.strip()]
    count = len(lines)
    pat_str = f" `{pattern}`" if pattern else ""
    sample = ", ".join(lines[:5])
    if count > 5:
        sample += f", ... (+{count - 5} more)"
    return f"[glob{pat_str}: {count} files. {sample}]"


def _summarize_generic(tool_name: str, content: str) -> str:
    """Fallback summary for unknown tool types."""
    lines = content.strip().splitlines()
    preview = content[:200].strip()
    return f"[{tool_name} result: {len(lines)} lines. {preview}...]"


_SUMMARIZERS = {
    "read_file": _summarize_read_file,
    "bash": _summarize_bash,
    "grep": _summarize_grep,
    "glob": _summarize_glob,
}


def _trim_tool_results(
    messages: list[ModelMessage],
    keep_recent: int = 3,
) -> tuple[list[ModelMessage], int]:
    """Replace large tool results in older messages with compact summaries.

    Returns (modified_messages, estimated_tokens_saved).
    """
    split_idx = _split_at_recent(messages, keep_recent)
    if split_idx == 0:
        return messages, 0

    # Track which files were read recently (for dedup)
    recent_reads: set[str] = set()
    for msg in messages[split_idx:]:
        if isinstance(msg, ModelResponse):
            for part in msg.parts:
                if isinstance(part, ToolCallPart) and part.tool_name == "read_file":
                    args_str = str(part.args) if part.args else ""
                    m = re.search(r'"path"\s*:\s*"([^"]+)"', args_str)
                    if m:
                        recent_reads.add(m.group(1))

    tokens_saved = 0
    new_messages: list[ModelMessage] = []

    for i, msg in enumerate(messages):
        if i >= split_idx or not isinstance(msg, ModelRequest):
            new_messages.append(msg)
            continue

        # Check if any ToolReturnPart needs trimming
        needs_change = False
        for part in msg.parts:
            if isinstance(part, ToolReturnPart) and content_byte_size(part) > SMALL_RESULT:
                needs_change = True
                break

        if not needs_change:
            new_messages.append(msg)
            continue

        # Build new parts list with trimmed tool results
        new_parts = []
        for part in msg.parts:
            if not isinstance(part, ToolReturnPart):
                new_parts.append(part)
                continue

            size = content_byte_size(part)
            if size <= SMALL_RESULT:
                new_parts.append(part)
                continue

            content_str = str(part.content) if part.content else ""
            args_str = _find_tool_args(messages, part.tool_call_id)
            old_tokens = int(size / 3.5)

            # Force-trim if this file was re-read more recently
            if part.tool_name == "read_file" and args_str:
                m_path = re.search(r'"path"\s*:\s*"([^"]+)"', args_str)
                if m_path and m_path.group(1) in recent_reads:
                    # Recent turn has a newer read — always summarize this one
                    summarizer = _SUMMARIZERS.get(part.tool_name)
                    if summarizer:
                        new_content = summarizer(content_str, args_str)
                    else:
                        new_content = _summarize_generic(part.tool_name, content_str)
                    new_tokens = int(len(new_content) / 3.5)
                    tokens_saved += max(old_tokens - new_tokens, 0)
                    new_parts.append(ToolReturnPart(
                        tool_name=part.tool_name,
                        content=new_content,
                        tool_call_id=part.tool_call_id,
                        timestamp=part.timestamp,
                    ))
                    continue

            if size <= MEDIUM_RESULT:
                # Truncate: keep head + tail
                head = content_str[:500]
                tail = content_str[-500:]
                new_content = f"{head}\n[...trimmed {len(content_str) - 1000} chars...]\n{tail}"
            else:
                # Full summary replacement
                summarizer = _SUMMARIZERS.get(part.tool_name)
                if summarizer:
                    new_content = summarizer(content_str, args_str)
                else:
                    new_content = _summarize_generic(part.tool_name, content_str)

            new_tokens = int(len(new_content) / 3.5)
            tokens_saved += max(old_tokens - new_tokens, 0)

            new_parts.append(ToolReturnPart(
                tool_name=part.tool_name,
                content=new_content,
                tool_call_id=part.tool_call_id,
                timestamp=part.timestamp,
            ))

        new_messages.append(ModelRequest(parts=new_parts, instructions=msg.instructions))

    return new_messages, tokens_saved


# ---------------------------------------------------------------------------
# Layer 2: Chunked Turn Summarization
# ---------------------------------------------------------------------------

async def _summarize_old_turns(
    messages: list[ModelMessage],
    keep_recent: int = 5,
    chunk_size: int = 5,
) -> tuple[list[ModelMessage], int]:
    """Summarize old turns in chunks, preserving more structure than full compaction.

    Returns (modified_messages, estimated_tokens_saved).
    """
    from backend.agent.compact import _extract_text, _summarizer

    split_idx = _split_at_recent(messages, keep_recent)
    if split_idx <= 2:
        return messages, 0

    old_messages = messages[:split_idx]
    recent_messages = messages[split_idx:]
    old_tokens = estimate_history_tokens(old_messages)

    # Group old messages into chunks by turn boundaries
    chunks: list[list[ModelMessage]] = []
    current_chunk: list[ModelMessage] = []
    response_count = 0

    for msg in old_messages:
        current_chunk.append(msg)
        if isinstance(msg, ModelResponse):
            response_count += 1
            if response_count >= chunk_size:
                chunks.append(current_chunk)
                current_chunk = []
                response_count = 0
    if current_chunk:
        chunks.append(current_chunk)

    if len(chunks) <= 1:
        # Not enough to chunk — let Layer 3 handle it
        return messages, 0

    # Summarize each chunk
    summary_messages: list[ModelMessage] = []
    for i, chunk in enumerate(chunks):
        text = _extract_text(chunk)
        if not text.strip():
            continue
        prompt = (
            f"Summarize this segment (part {i + 1}/{len(chunks)}) of a coding conversation. "
            "Preserve key decisions, file paths, code changes, and context needed to continue. "
            f"Be concise.\n\nConversation segment:\n{text}"
        )
        try:
            result = await _summarizer.run(prompt)
            summary = result.output
        except Exception:
            # If summarization fails, keep original chunk
            summary_messages.extend(chunk)
            continue

        summary_messages.append(
            ModelRequest.user_text_prompt(
                f"[Conversation summary, part {i + 1}/{len(chunks)}]\n{summary}"
            )
        )

    new_messages = summary_messages + list(recent_messages)
    new_tokens = estimate_history_tokens(new_messages)
    saved = max(old_tokens - (new_tokens - estimate_history_tokens(recent_messages)), 0)

    return new_messages, saved
