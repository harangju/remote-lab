"""Project context gathering for agent system prompts."""

from __future__ import annotations

import os
from pathlib import Path

_EXCLUDED_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv", ".env",
    ".next", "dist", "build", ".cache", ".mypy_cache", ".ruff_cache",
}

_MAX_CLAUDE_MD = 10_000


def read_claude_md(project_path: Path) -> str | None:
    """Read CLAUDE.md from project root or .claude/ directory."""
    for candidate in [
        project_path / "CLAUDE.md",
        project_path / ".claude" / "CLAUDE.md",
    ]:
        if candidate.is_file():
            try:
                text = candidate.read_text(errors="replace")
                if len(text) > _MAX_CLAUDE_MD:
                    text = text[:_MAX_CLAUDE_MD] + "\n... (truncated)"
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

    sections.append(
        f"# Project Context\n\nWorking directory: {project_path}\n\n"
        "Use `/share <path> [token]` to publish a project markdown or HTML file into the app's public web directory and return a tokenized link. "
        "Use `/shares` to list shared files and links. "
        "Use `/unshare <path-or-slug>` to remove its access token requirement."
    )

    claude_md = read_claude_md(project_path)
    if claude_md:
        sections.append(f"## Project Instructions (CLAUDE.md)\n\n{claude_md}")

    if is_first_turn:
        tree = get_directory_tree(project_path)
        if tree:
            sections.append(f"## Project Structure\n\n```\n{tree}\n```")

    # If we only have the working directory line and nothing else, skip
    if len(sections) <= 1 and not is_first_turn:
        return None

    return "\n\n".join(sections)
