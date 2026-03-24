"""Project context gathering for agent system prompts."""

from __future__ import annotations

import os
from pathlib import Path
from typing import TYPE_CHECKING

from backend.agent.skills import get_skills, SkillType

if TYPE_CHECKING:
    from backend.agent.agent_config import AgentConfig

_EXCLUDED_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv", ".env",
    ".next", "dist", "build", ".cache", ".mypy_cache", ".ruff_cache",
}

_MAX_INSTRUCTIONS = 10_000

_INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"]


def read_instructions(project_path: Path) -> str | None:
    """Read project instructions (AGENTS.md or CLAUDE.md) from project root or .claude/ directory."""
    for name in _INSTRUCTION_FILES:
        for candidate in [
            project_path / name,
            project_path / ".claude" / name,
        ]:
            if candidate.is_file():
                try:
                    text = candidate.read_text(errors="replace")
                    if len(text) > _MAX_INSTRUCTIONS:
                        text = text[:_MAX_INSTRUCTIONS] + "\n... (truncated)"
                    return text
                except Exception:
                    return None
    return None


def get_directory_tree(project_path: Path, max_depth: int = 2, max_entries: int = 100) -> str:
    """Generate a compact directory tree string."""
    lines: list[str] = []
    count = 0

    for root, dirs, files in os.walk(project_path):
        # Filter excluded dirs in-place
        dirs[:] = sorted(d for d in dirs if d not in _EXCLUDED_DIRS and not d.startswith("."))

        depth = str(root).replace(str(project_path), "").count(os.sep)
        if depth >= max_depth:
            dirs.clear()
            continue

        indent = "  " * depth
        if depth > 0:
            dirname = os.path.basename(root)
            lines.append(f"{indent}{dirname}/")
            count += 1
        else:
            # Show top-level files first
            pass

        for f in sorted(files):
            if f.startswith("."):
                continue
            lines.append(f"{'  ' * (depth + (1 if depth > 0 else 0))}{f}")
            count += 1
            if count >= max_entries:
                lines.append("  ... (truncated)")
                return "\n".join(lines)

    return "\n".join(lines)


def build_project_instructions(
    project_path: Path,
    is_first_turn: bool,
    agents: list[AgentConfig] | None = None,
) -> str | None:
    """Build dynamic per-call instructions with project context.

    Returns None if there's nothing project-specific to inject.
    """
    sections: list[str] = []

    skills = get_skills(project_path if project_path.is_dir() else None)
    prompt_skills = sorted((s for s in skills if s.type == SkillType.prompt), key=lambda s: s.name)
    server_skills = sorted(s.name for s in skills if s.type == SkillType.server)

    skill_lines: list[str] = []
    if prompt_skills:
        # One-line list only — full instructions loaded via activate_skill
        skill_lines.append(f"Available skills (use `activate_skill` to load): {', '.join(f'`/{s.name}`' for s in prompt_skills)}.")
    if server_skills:
        server_list = ", ".join(f"`/{name}`" for name in server_skills)
        skill_lines.append(f"Server commands: {server_list}.")

    context_intro = [f"# Project Context\n\nWorking directory: {project_path}"]
    if skill_lines:
        context_intro.append(" ".join(skill_lines))

    sections.append("\n\n".join(context_intro))

    # List agents available for delegation
    if agents:
        agent_lines = []
        for a in agents:
            desc = a.system_prompt[:120].replace("\n", " ") if a.system_prompt else ""
            tools_note = f" (tools: {', '.join(a.tools)})" if a.tools else ""
            agent_lines.append(f"- **{a.id}** — {a.name}{tools_note}: {desc}")
        sections.append(
            "## Available Agents\n\n"
            "Use `delegate(agent_id, task)` to run sub-agents. "
            "Multiple delegate calls in one response run in parallel.\n\n"
            + "\n".join(agent_lines)
        )

    if is_first_turn:
        instructions = read_instructions(project_path)
        if instructions:
            sections.append(f"## Project Instructions\n\n{instructions}")

        tree = get_directory_tree(project_path)
        if tree:
            sections.append(f"## Project Structure\n\n```\n{tree}\n```")

    # If we only have the working directory line and nothing else, skip
    if len(sections) <= 1 and not is_first_turn:
        return None

    return "\n\n".join(sections)
