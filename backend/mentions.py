"""Parse @mentions from user input to route messages to agents and reference files."""

from __future__ import annotations

import re
from pathlib import Path

from backend.agent_config import AgentConfig

# Matches @word (agent IDs) — does NOT match paths with / or .
_AGENT_MENTION_RE = re.compile(r"@(\w+)")

# Matches @path/to/file.ext — must contain a / or . to distinguish from agents
_FILE_MENTION_RE = re.compile(r"@([\w./\-]+(?:/[\w./\-]+|\.[\w]+))")


def parse_mentions(
    text: str, agents: list[AgentConfig]
) -> tuple[list[AgentConfig], str]:
    """Parse @mentions from user text.

    Returns (matched_agents, cleaned_text).
    If no mentions match, returns the default agent and the original text.
    """
    agent_by_id = {a.id.lower(): a for a in agents}
    agent_by_name = {a.name.lower(): a for a in agents}

    found: list[AgentConfig] = []
    seen: set[str] = set()

    def _replace(match: re.Match) -> str:
        key = match.group(1).lower()
        ag = agent_by_id.get(key) or agent_by_name.get(key)
        if ag and ag.id not in seen:
            found.append(ag)
            seen.add(ag.id)
            return ""
        return match.group(0)  # leave unrecognised mentions

    cleaned = _AGENT_MENTION_RE.sub(_replace, text).strip()

    if not found:
        defaults = [a for a in agents if a.is_default]
        if not defaults and agents:
            defaults = [agents[0]]
        return defaults, text

    return found, cleaned


def extract_file_mentions(text: str, project_path: Path) -> tuple[list[tuple[str, str]], str]:
    """Extract @file references from text, reading their contents.

    Returns ([(path, content), ...], cleaned_text) where file mentions
    are removed from the text.
    """
    files: list[tuple[str, str]] = []
    seen: set[str] = set()

    def _replace(match: re.Match) -> str:
        rel_path = match.group(1)
        if rel_path in seen:
            return ""
        target = (project_path / rel_path).resolve()
        # Security: ensure within project
        if not str(target).startswith(str(project_path.resolve())):
            return match.group(0)
        if target.is_file():
            try:
                content = target.read_text(errors="replace")
                # Cap at 50KB per file
                if len(content) > 50_000:
                    content = content[:50_000] + "\n\n--- truncated at 50KB ---"
                files.append((rel_path, content))
                seen.add(rel_path)
                return ""
            except Exception:
                return match.group(0)
        return match.group(0)  # leave unresolved references

    cleaned = _FILE_MENTION_RE.sub(_replace, text).strip()
    return files, cleaned
