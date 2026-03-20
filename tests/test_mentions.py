from __future__ import annotations

from pathlib import Path

from backend.agent_config import AgentConfig
from backend.mentions import extract_file_mentions, parse_mentions


def test_parse_mentions_prefers_explicit_matches_and_cleans_text():
    agents = [
        AgentConfig(id="worker", name="Worker", is_default=True),
        AgentConfig(id="reviewer", name="Reviewer"),
    ]

    matched, cleaned = parse_mentions("@reviewer please check this", agents)
    assert [agent.id for agent in matched] == ["reviewer"]
    assert cleaned == "please check this"


def test_parse_mentions_falls_back_to_default_agent():
    agents = [AgentConfig(id="worker", name="Worker", is_default=True)]
    matched, cleaned = parse_mentions("no explicit mention", agents)
    assert [agent.id for agent in matched] == ["worker"]
    assert cleaned == "no explicit mention"


def test_extract_file_mentions_reads_project_files(tmp_path: Path):
    project_path = tmp_path / "project"
    project_path.mkdir()
    file_path = project_path / "src" / "main.py"
    file_path.parent.mkdir(parents=True)
    file_path.write_text("print('hi')\n")

    files, cleaned = extract_file_mentions("look at @src/main.py please", project_path)
    assert files == [("src/main.py", "print('hi')\n")]
    assert cleaned == "look at  please"


def test_extract_file_mentions_rejects_path_traversal(tmp_path: Path):
    project_path = tmp_path / "project"
    project_path.mkdir()
    outside = tmp_path / "outside.txt"
    outside.write_text("secret")

    files, cleaned = extract_file_mentions("@../outside.txt should stay", project_path)
    assert files == []
    assert cleaned == "@../outside.txt should stay"
