from __future__ import annotations

from pathlib import Path

from backend.agent.context import build_project_instructions
from backend.agent.skills import SkillType, get_skill, get_skills


def test_packaged_project_skill_is_loaded(tmp_path: Path):
    project_path = tmp_path / "project"
    skill_dir = project_path / ".agent" / "skills" / "demo"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: demo\ndescription: Demo skill\n---\n\nUse demo skill."
    )
    (skill_dir / "notes.md").write_text("Extra notes")

    skill = get_skill("demo", project_path)
    assert skill is not None
    assert skill.type == SkillType.prompt
    assert skill.description == "Demo skill"
    assert "Use demo skill." in skill.prompt
    assert "Extra notes" in skill.prompt


def test_build_project_instructions_includes_skills_and_structure(tmp_path: Path):
    project_path = tmp_path / "project"
    project_path.mkdir()
    (project_path / "AGENTS.md").write_text("Project instructions here")
    (project_path / "app.py").write_text("print('hello')\n")
    skill_dir = project_path / ".agent" / "skills" / "demo"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: demo\ndescription: Demo skill\n---\n\nUse demo skill."
    )

    instructions = build_project_instructions(project_path, True)
    assert instructions is not None
    assert "Working directory" in instructions
    assert "`/demo`" in instructions
    assert "Project instructions here" in instructions
    assert "app.py" in instructions


def test_get_skills_contains_builtin_server_commands():
    skills = get_skills(None)
    names = {skill.name for skill in skills}
    assert {"compact", "model", "share", "shares", "unshare"}.issubset(names)


def test_malformed_skill_front_matter_falls_back_to_prompt_text(tmp_path: Path):
    project_path = tmp_path / "project"
    skill_dir = project_path / ".agent" / "skills" / "broken"
    skill_dir.mkdir(parents=True)
    raw = "---\nname: broken\ndescription: [unterminated\n---\n\nRaw prompt body"
    (skill_dir / "SKILL.md").write_text(raw)

    skill = get_skill("broken", project_path)
    assert skill is not None
    assert skill.type == SkillType.prompt
    assert "Raw prompt body" in skill.prompt
