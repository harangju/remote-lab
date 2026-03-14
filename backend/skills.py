"""Skill registry: built-in server skills + file-based prompt skills.

Skill sources (in priority order, last wins for same name):
1. Built-in server skills (compact, clear, model)
2. Global file skills from data/skills/*.md
3. Project file skills from {project_path}/.agent/skills/*.md
"""

from __future__ import annotations

from enum import Enum
from pathlib import Path

from pydantic import BaseModel


class SkillType(str, Enum):
    server = "server"
    prompt = "prompt"


class Skill(BaseModel):
    name: str
    type: SkillType
    description: str
    prompt: str = ""  # only for prompt-type skills


# Built-in server skills (require backend code to execute)
BUILTIN_SKILLS: list[Skill] = [
    Skill(name="compact", type=SkillType.server, description="Compact conversation context"),
    Skill(name="model", type=SkillType.server, description="Show current model info"),
    Skill(name="share", type=SkillType.server, description="Publish a markdown or HTML file: /share <path>"),
]

# Global skills directory (alongside other data files)
GLOBAL_SKILLS_DIR = Path(__file__).parent.parent / "data" / "skills"

# Cache for file-based skills per directory
_skill_cache: dict[str, tuple[float, list[Skill]]] = {}


def _load_dir_skills(skills_dir: Path) -> list[Skill]:
    """Discover prompt skills from a directory of .md files."""
    if not skills_dir.is_dir():
        return []

    # Simple mtime-based cache
    cache_key = str(skills_dir)
    try:
        mtime = max(f.stat().st_mtime for f in skills_dir.iterdir() if f.suffix == ".md")
    except (ValueError, OSError):
        return []

    cached = _skill_cache.get(cache_key)
    if cached and cached[0] >= mtime:
        return cached[1]

    skills: list[Skill] = []
    for f in sorted(skills_dir.glob("*.md")):
        name = f.stem
        content = f.read_text().strip()
        if not content:
            continue
        # First line as description if it starts with #, otherwise use filename
        first_line = content.split("\n")[0].strip()
        if first_line.startswith("#"):
            description = first_line.lstrip("# ").strip()
        else:
            description = name.replace("-", " ").replace("_", " ").capitalize()
        skills.append(Skill(
            name=name,
            type=SkillType.prompt,
            description=description,
            prompt=content,
        ))

    _skill_cache[cache_key] = (mtime, skills)
    return skills


def get_skills(project_path: Path | None = None) -> list[Skill]:
    """Return all available skills (built-in + global + project).

    Project skills override global skills with the same name.
    """
    # Start with built-ins
    by_name: dict[str, Skill] = {s.name: s for s in BUILTIN_SKILLS}

    # Layer on global file skills
    for s in _load_dir_skills(GLOBAL_SKILLS_DIR):
        by_name[s.name] = s

    # Layer on project-specific file skills
    if project_path:
        for s in _load_dir_skills(project_path / ".agent" / "skills"):
            by_name[s.name] = s

    return list(by_name.values())


def get_skill(name: str, project_path: Path | None = None) -> Skill | None:
    """Look up a skill by name."""
    for s in get_skills(project_path):
        if s.name == name:
            return s
    return None
