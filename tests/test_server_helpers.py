from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException


def test_check_token_requires_exact_match(server_module):
    server = server_module
    server.WS_TOKEN = "secret-token"

    assert server.check_token("secret-token") is True
    assert server.check_token("wrong-token") is False
    assert server.check_token("") is False


def test_parse_share_args_splits_optional_token(server_module):
    server = server_module

    assert server._parse_share_args("docs/report.md abc123") == ("docs/report.md", "abc123")
    assert server._parse_share_args("docs/report.md") == ("docs/report.md", None)
    assert server._parse_share_args("  ") == ("", None)


def test_resolve_share_source_handles_direct_match_and_errors(server_module, tmp_path: Path):
    server = server_module
    project_root = tmp_path / "project"
    project_root.mkdir()
    report = project_root / "docs" / "report.md"
    report.parent.mkdir(parents=True)
    report.write_text("# Report\n")

    source, error = server._resolve_share_source(project_root, "docs/report.md")
    assert source == report
    assert error is None

    source, error = server._resolve_share_source(project_root, "")
    assert source is None
    assert error is not None

    source, error = server._resolve_share_source(project_root, "../outside.md")
    assert source is None
    assert error == "Source file must be inside the current project"


def test_resolve_share_source_reports_ambiguous_matches(server_module, tmp_path: Path):
    server = server_module
    project_root = tmp_path / "project"
    project_root.mkdir()
    for subdir in ("a", "b"):
        path = project_root / subdir / "report.md"
        path.parent.mkdir(parents=True)
        path.write_text("# Report\n")

    source, error = server._resolve_share_source(project_root, "report")
    assert source is None
    assert error is not None
    assert error.startswith("Multiple matching files found:")


def test_build_shared_context_summarizes_tools_and_filters_server_commands(server_module, storage_module, tmp_path: Path):
    server = server_module
    storage = storage_module
    project = storage.create_project(server.ProjectCreate(name="Demo", path=str(tmp_path / "project")))
    convo = storage.create_conversation(project.id, "Context test")

    storage.append_event(convo.id, {"type": "user-message", "role": "user", "content": "/model", "server_command": True})
    storage.append_event(convo.id, {"type": "user-message", "role": "user", "content": "real question"})
    storage.append_event(convo.id, {"type": "tool-call", "role": "tool", "name": "read_file", "input": "src/app.py", "tool_call_id": "tc1"})
    storage.append_event(convo.id, {"type": "tool-output", "role": "tool", "name": "read_file", "output": "chunk ", "tool_call_id": "tc1"})
    storage.append_event(convo.id, {"type": "tool-result", "role": "tool", "name": "read_file", "output": "done", "tool_call_id": "tc1"})
    storage.append_event(convo.id, {"type": "assistant-message", "role": "assistant", "content": "answer", "agent_id": "worker"})

    shared = server._build_shared_context(convo.id, agent_id=None)
    assert "User: real question" in shared
    assert "Tool read_file input=src/app.py output=done" in shared
    assert "[@worker]: answer" in shared
    assert "/model" not in shared


def test_resolve_project_file_rejects_missing_project_and_traversal(server_module, storage_module, tmp_path: Path):
    server = server_module
    storage = storage_module
    project = storage.create_project(server.ProjectCreate(name="Demo", path=str(tmp_path / "project")))
    project_root = Path(project.path)
    project_root.mkdir(parents=True, exist_ok=True)
    file_path = project_root / "notes.txt"
    file_path.write_text("hello")

    _, resolved = server._resolve_project_file(project.id, "notes.txt")
    assert resolved == file_path.resolve()

    try:
        server._resolve_project_file("missing", "notes.txt")
    except HTTPException as exc:
        assert exc.status_code == 404
    else:
        raise AssertionError("expected HTTPException for missing project")

    try:
        server._resolve_project_file(project.id, "../escape.txt")
    except HTTPException as exc:
        assert exc.status_code == 403
    else:
        raise AssertionError("expected HTTPException for traversal")
