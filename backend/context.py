"""Project context gathering for agent system prompts."""

from __future__ import annotations

import os
from pathlib import Path

from backend.skills import get_skills, SkillType, GLOBAL_SKILLS_DIR

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


def build_project_instructions(project_path: Path, is_first_turn: bool) -> str | None:
    """Build dynamic per-call instructions with project context.

    Returns None if there's nothing project-specific to inject.
    """
    sections: list[str] = []

    skills = get_skills(project_path if project_path.is_dir() else None)
    prompt_skills = sorted((s for s in skills if s.type == SkillType.prompt), key=lambda s: s.name)
    server_skills = sorted(s.name for s in skills if s.type == SkillType.server)

    skill_lines: list[str] = []
    if prompt_skills:
        prompt_list = ", ".join(f"`/{s.name}`" for s in prompt_skills)
        skill_catalog = "\n".join(
            f"- `{s.name}` — {s.description}" + (f" (`{s.location}`)" if s.location else "")
            for s in prompt_skills
        )
        skill_lines.append(
            f"Filesystem agent skills are available under `{GLOBAL_SKILLS_DIR.relative_to(Path(__file__).parent.parent).as_posix()}/` globally and `.agent/skills/` per project. "
            f"Available packaged skills here include: {prompt_list}. These are normal on-disk agent skills with `SKILL.md` files and companion resources."
        )
        skill_lines.append(
            "When a task matches a skill's description, use the `activate_skill` tool to load its full instructions before proceeding. "
            "When a skill references relative paths, resolve them against the skill directory reported by that tool."
        )
        skill_lines.append(
            "If the user types a slash form like `/docx`, `/pdf`, `/xlsx`, or `/pptx`, treat that as an explicit request to activate the corresponding skill. Those slash forms are user-facing activation syntax handled by the harness; they are not expected to appear in your callable tool list. Your job is to use `activate_skill` for the matching skill."
        )
        skill_lines.append(f"Available skills:\n{skill_catalog}")
    if server_skills:
        server_list = ", ".join(f"`/{name}`" for name in server_skills)
        skill_lines.append(f"Actual server-side chat commands available here: {server_list}.")

    context_intro = [f"# Project Context\n\nWorking directory: {project_path}"]
    if skill_lines:
        context_intro.append(" ".join(skill_lines))
    context_intro.append(
        "Use `/share <path> [token]` to publish a project markdown or HTML file into the app's public web directory and return a tokenized link. "
        "Use `/shares` to list shared files and links. "
        "Use `/unshare <path-or-slug>` to remove its access token requirement."
    )

    sections.append("\n\n".join(context_intro))

    instructions = read_instructions(project_path)
    if instructions:
        sections.append(f"## Project Instructions\n\n{instructions}")

    if is_first_turn:
        tree = get_directory_tree(project_path)
        if tree:
            sections.append(f"## Project Structure\n\n```\n{tree}\n```")

    # If we only have the working directory line and nothing else, skip
    if len(sections) <= 1 and not is_first_turn:
        return None

    return "\n\n".join(sections)
