"""Parse @mentions from user input to route messages to agents."""

from __future__ import annotations

import re

from backend.agent_config import AgentConfig

_MENTION_RE = re.compile(r"@(\w+)")


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

    cleaned = _MENTION_RE.sub(_replace, text).strip()

    if not found:
        defaults = [a for a in agents if a.is_default]
        if not defaults and agents:
            defaults = [agents[0]]
        return defaults, text

    return found, cleaned
