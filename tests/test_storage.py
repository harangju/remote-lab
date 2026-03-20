from __future__ import annotations

from backend.models import ProjectCreate


def test_project_and_conversation_crud_and_pagination(storage_module, tmp_path):
    storage = storage_module
    project_dir = tmp_path / "project"

    project = storage.create_project(ProjectCreate(name="Demo", path=str(project_dir)))
    assert project.name == "Demo"
    assert storage.get_project(project.id) is not None

    convo = storage.create_conversation(project.id, "Test convo")
    storage.append_event(convo.id, {"type": "user-message", "role": "user", "content": "one"})
    storage.append_event(convo.id, {"type": "assistant-message", "role": "assistant", "content": "two", "context_tokens": 12, "context_limit": 100})
    storage.append_event(convo.id, {"type": "user-message", "role": "user", "content": "three"})

    detail = storage.get_conversation(convo.id, limit=2)
    assert [m["content"] for m in detail.messages] == ["two", "three"]
    assert detail.has_more is True
    assert detail.next_before == 1
    assert detail.context_tokens == 12
    assert detail.context_limit == 100

    older = storage.get_conversation(convo.id, before=detail.next_before, limit=2)
    assert [m["content"] for m in older.messages] == ["one"]
    assert older.has_more is False
    assert older.next_before is None

    updated = storage.update_conversation_title(convo.id, "Renamed")
    assert updated is not None
    assert updated.title == "Renamed"

    assert storage.delete_conversation(convo.id) is True
    assert storage.get_conversation(convo.id) is None


def test_append_event_updates_project_timestamp(storage_module, tmp_path):
    storage = storage_module
    project = storage.create_project(ProjectCreate(name="Demo", path=str(tmp_path / "project")))
    convo = storage.create_conversation(project.id, "Bump me")
    before = storage.get_project(project.id)
    assert before is not None

    storage.append_event(convo.id, {"type": "user-message", "role": "user", "content": "bump"})

    after = storage.get_project(project.id)
    assert after is not None
    assert after.updated_at >= before.updated_at
