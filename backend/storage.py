"""Flat-file storage for projects and conversations.

Data layout:
    data/projects.json                    — list of Project dicts
    data/conversations/{id}.meta.json     — ConvoMeta dict
    data/conversations/{id}.jsonl         — one JSON object per line (message events)
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from backend.models import (
    ConvoDetail,
    ConvoMeta,
    ConvoStatus,
    Project,
    ProjectCreate,
    ProjectUpdate,
)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

DATA_DIR = Path(__file__).parent.parent / "data"
PROJECTS_FILE = DATA_DIR / "projects.json"
CONVOS_DIR = DATA_DIR / "conversations"


def _ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CONVOS_DIR.mkdir(parents=True, exist_ok=True)


def _now() -> str:
    return datetime.utcnow().isoformat()


def _new_id() -> str:
    return uuid4().hex[:12]


# ---------------------------------------------------------------------------
# Project helpers
# ---------------------------------------------------------------------------


def _read_projects() -> list[dict]:
    if not PROJECTS_FILE.exists():
        return []
    return json.loads(PROJECTS_FILE.read_text())


def _write_projects(projects: list[dict]) -> None:
    _ensure_dirs()
    PROJECTS_FILE.write_text(json.dumps(projects, indent=2))


# ---------------------------------------------------------------------------
# Project CRUD
# ---------------------------------------------------------------------------


def list_projects() -> list[Project]:
    return [Project(**p) for p in _read_projects()]


def get_project(project_id: str) -> Project | None:
    for p in _read_projects():
        if p["id"] == project_id:
            return Project(**p)
    return None


def create_project(data: ProjectCreate) -> Project:
    projects = _read_projects()
    proj = Project(
        id=_new_id(),
        name=data.name,
        path=data.path,
        created_at=_now(),
    )
    projects.append(proj.model_dump())
    _write_projects(projects)
    return proj


def update_project(project_id: str, data: ProjectUpdate) -> Project | None:
    projects = _read_projects()
    for p in projects:
        if p["id"] == project_id:
            if data.name is not None:
                p["name"] = data.name
            if data.path is not None:
                p["path"] = data.path
            _write_projects(projects)
            return Project(**p)
    return None


def delete_project(project_id: str) -> bool:
    projects = _read_projects()
    new = [p for p in projects if p["id"] != project_id]
    if len(new) == len(projects):
        return False
    _write_projects(new)
    return True


# ---------------------------------------------------------------------------
# Conversation helpers
# ---------------------------------------------------------------------------


def _meta_path(convo_id: str) -> Path:
    return CONVOS_DIR / f"{convo_id}.meta.json"


def _messages_path(convo_id: str) -> Path:
    return CONVOS_DIR / f"{convo_id}.jsonl"


def _read_meta(convo_id: str) -> ConvoMeta | None:
    p = _meta_path(convo_id)
    if not p.exists():
        return None
    return ConvoMeta(**json.loads(p.read_text()))


def _write_meta(meta: ConvoMeta) -> None:
    _ensure_dirs()
    _meta_path(meta.id).write_text(json.dumps(meta.model_dump(), indent=2))


# ---------------------------------------------------------------------------
# Conversation CRUD
# ---------------------------------------------------------------------------


def list_conversations(project_id: str) -> list[ConvoMeta]:
    _ensure_dirs()
    results: list[ConvoMeta] = []
    for f in CONVOS_DIR.glob("*.meta.json"):
        meta = ConvoMeta(**json.loads(f.read_text()))
        if meta.project_id == project_id:
            results.append(meta)
    results.sort(key=lambda m: m.updated_at, reverse=True)
    return results


def create_conversation(project_id: str, title: str | None = None) -> ConvoMeta:
    _ensure_dirs()
    convo_id = _new_id()
    now = _now()
    meta = ConvoMeta(
        id=convo_id,
        project_id=project_id,
        title=title or "Untitled",
        status=ConvoStatus.idle,
        created_at=now,
        updated_at=now,
    )
    _write_meta(meta)
    # Create empty JSONL file
    _messages_path(convo_id).write_text("")
    return meta


def get_conversation(convo_id: str) -> ConvoDetail | None:
    meta = _read_meta(convo_id)
    if meta is None:
        return None
    messages = read_messages(convo_id)
    return ConvoDetail(**meta.model_dump(), messages=messages)


def delete_conversation(convo_id: str) -> bool:
    meta_p = _meta_path(convo_id)
    msg_p = _messages_path(convo_id)
    if not meta_p.exists():
        return False
    meta_p.unlink()
    if msg_p.exists():
        msg_p.unlink()
    return True


def update_conversation_status(convo_id: str, status: ConvoStatus) -> ConvoMeta | None:
    meta = _read_meta(convo_id)
    if meta is None:
        return None
    meta.status = status
    meta.updated_at = _now()
    _write_meta(meta)
    return meta


# ---------------------------------------------------------------------------
# Message I/O
# ---------------------------------------------------------------------------


def append_message(convo_id: str, event: dict) -> None:
    """Append a single JSON event as a line to the conversation JSONL file."""
    _ensure_dirs()
    p = _messages_path(convo_id)
    with p.open("a") as f:
        f.write(json.dumps(event) + "\n")
    # Touch the meta updated_at
    meta = _read_meta(convo_id)
    if meta:
        meta.updated_at = _now()
        _write_meta(meta)


def read_messages(convo_id: str) -> list[dict]:
    """Read all message events from the conversation JSONL file."""
    p = _messages_path(convo_id)
    if not p.exists():
        return []
    messages: list[dict] = []
    for line in p.read_text().splitlines():
        line = line.strip()
        if line:
            messages.append(json.loads(line))
    return messages
