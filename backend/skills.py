"""Skill registry: built-in server skills + filesystem skill metadata.

Skill sources (in priority order, last wins for same name):
1. Built-in server skills (compact, model, share, shares, unshare)
2. Global skills from skills/ (`*.md` or `<skill>/SKILL.md`)
3. Project skills from {project_path}/.agent/skills/ (`*.md` or `<skill>/SKILL.md`)
"""

from __future__ import annotations

from enum import Enum
from pathlib import Path

import yaml
from pydantic import BaseModel


class SkillType(str, Enum):
    server = "server"
    prompt = "prompt"


class Skill(BaseModel):
    name: str
    type: SkillType
    description: str
    prompt: str = ""  # only for prompt-type skills
    location: str | None = None


def _parse_prompt_skill(content: str, fallback_name: str) -> tuple[str, str, str]:
    """Parse a markdown skill file, supporting optional YAML front matter."""
    text = content.strip()
    if not text:
        return fallback_name, fallback_name.replace("-", " ").replace("_", " ").capitalize(), ""

    name = fallback_name
    description = fallback_name.replace("-", " ").replace("_", " ").capitalize()
    prompt = text

    if text.startswith("---\n"):
        parts = text.split("\n---\n", 1)
        if len(parts) == 2:
            front_matter, body = parts
            try:
                meta = yaml.safe_load(front_matter[4:]) or {}
                if isinstance(meta, dict):
                    meta_name = meta.get("name")
                    meta_description = meta.get("description")
                    if isinstance(meta_name, str) and meta_name.strip():
                        name = meta_name.strip()
                    if isinstance(meta_description, str) and meta_description.strip():
                        description = meta_description.strip()
                    prompt = body.strip()
            except Exception:
                prompt = text

    if not description and prompt:
        first_line = prompt.split("\n")[0].strip()
        if first_line.startswith("#"):
            description = first_line.lstrip("# ").strip()
    if not description:
        description = fallback_name.replace("-", " ").replace("_", " ").capitalize()

    return name, description, prompt


# Built-in server skills (require backend code to execute)
BUILTIN_SKILLS: list[Skill] = [
    Skill(name="compact", type=SkillType.server, description="Compact conversation context"),
    Skill(name="model", type=SkillType.server, description="Show current model info"),
    Skill(name="share", type=SkillType.server, description="Publish a markdown, HTML, or PDF file and return a tokenized link: /share <path> [token]"),
    Skill(name="shares", type=SkillType.server, description="List shared files and their tokenized links: /shares"),
    Skill(name="unshare", type=SkillType.server, description="Remove a shared file's access token requirement: /unshare <path-or-slug>"),
]

# Global filesystem skills directory
GLOBAL_SKILLS_DIR = Path(__file__).parent.parent / "skills"

# Cache for file-based skills per directory
_skill_cache: dict[str, tuple[float, list[Skill]]] = {}


def _dir_mtime(path: Path) -> float:
    latest = path.stat().st_mtime
    for child in path.rglob("*"):
        try:
            latest = max(latest, child.stat().st_mtime)
        except OSError:
            continue
    return latest


def _build_packaged_skill(skill_dir: Path) -> Skill | None:
    skill_file = skill_dir / "SKILL.md"
    if not skill_file.is_file():
        return None

    content = skill_file.read_text()
    if not content.strip():
        return None

    name, description, prompt = _parse_prompt_skill(content, skill_dir.name)

    extras: list[str] = []
    for extra in sorted(skill_dir.glob("*.md")):
        if extra.name == "SKILL.md":
            continue
        rel = extra.relative_to(skill_dir)
        extras.append(f"## {rel.as_posix()}\n\n{extra.read_text().strip()}")

    if extras:
        prompt = prompt.rstrip() + "\n\n" + "\n\n".join(extras)

    script_files = sorted(p for p in (skill_dir / "scripts").rglob("*") if p.is_file()) if (skill_dir / "scripts").is_dir() else []
    if script_files:
        script_list = "\n".join(f"- scripts/{p.relative_to(skill_dir / 'scripts').as_posix()}" for p in script_files)
        prompt = prompt.rstrip() + "\n\n## Bundled scripts available in this skill\n\n" + script_list

    return Skill(name=name, type=SkillType.prompt, description=description, prompt=prompt, location=str(skill_file))


def _load_dir_skills(skills_dir: Path) -> list[Skill]:
    """Discover prompt skills from a directory of .md files or packaged skill dirs."""
    if not skills_dir.is_dir():
        return []

    cache_key = str(skills_dir)
    try:
        mtime = _dir_mtime(skills_dir)
    except OSError:
        return []

    cached = _skill_cache.get(cache_key)
    if cached and cached[0] >= mtime:
        return cached[1]

    skills: list[Skill] = []
    for f in sorted(skills_dir.glob("*.md")):
        content = f.read_text()
        if not content.strip():
            continue
        name, description, prompt = _parse_prompt_skill(content, f.stem)
        skills.append(Skill(
            name=name,
            type=SkillType.prompt,
            description=description,
            prompt=prompt,
            location=str(f),
        ))

    for subdir in sorted(p for p in skills_dir.iterdir() if p.is_dir()):
        skill = _build_packaged_skill(subdir)
        if skill:
            skills.append(skill)

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
