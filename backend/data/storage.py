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

from backend.agent.agent_config import AgentConfig
from backend.data.models import (
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

DATA_DIR = Path(__file__).parent.parent.parent / "data"
PROJECTS_FILE = DATA_DIR / "projects.json"
CONVOS_DIR = DATA_DIR / "conversations"
AGENTS_DIR = DATA_DIR / "agents"


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


def _project_sort_key(project: Project) -> tuple[str, str]:
    return (project.updated_at, project.created_at)


def list_projects() -> list[Project]:
    projects = [Project(**{**p, "updated_at": p.get("updated_at", p.get("created_at"))}) for p in _read_projects()]
    projects.sort(key=_project_sort_key, reverse=True)
    return projects


def get_project(project_id: str) -> Project | None:
    for p in _read_projects():
        if p["id"] == project_id:
            return Project(**{**p, "updated_at": p.get("updated_at", p.get("created_at"))})
    return None


def create_project(data: ProjectCreate) -> Project:
    projects = _read_projects()
    now = _now()
    proj = Project(
        id=_new_id(),
        name=data.name,
        path=data.path,
        created_at=now,
        updated_at=now,
        archived_at=None,
    )
    Path(data.path).mkdir(parents=True, exist_ok=True)
    projects.append(proj.model_dump())
    _write_projects(projects)
    return proj


def update_project(project_id: str, data: ProjectUpdate) -> Project | None:
    projects = _read_projects()
    for p in projects:
        if p["id"] == project_id:
            changed = False
            if data.name is not None and p.get("name") != data.name:
                p["name"] = data.name
                changed = True
            if data.path is not None and p.get("path") != data.path:
                p["path"] = data.path
                changed = True
            if "archived_at" in data.model_fields_set and p.get("archived_at") != data.archived_at:
                p["archived_at"] = data.archived_at
                changed = True
            if changed:
                p["updated_at"] = _now()
            else:
                p.setdefault("updated_at", p.get("created_at"))
            _write_projects(projects)
            return Project(**{**p, "updated_at": p.get("updated_at", p.get("created_at"))})
    return None


def delete_project(project_id: str) -> bool:
    projects = _read_projects()
    new = [p for p in projects if p["id"] != project_id]
    if len(new) == len(projects):
        return False
    _write_projects(new)
    return True


# ---------------------------------------------------------------------------
# Agent config per project
# ---------------------------------------------------------------------------


def _load_agents_file(path: Path) -> list[AgentConfig]:
    if not path.exists():
        return []
    data = json.loads(path.read_text())
    return [AgentConfig(**a) for a in data.get("agents", [])]


def _save_agents_file(path: Path, agents: list[AgentConfig]) -> None:
    AGENTS_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"agents": [a.model_dump() for a in agents]}, indent=2))


DEFAULT_AGENTS = [
    AgentConfig(
        id="orchestrator",
        name="Orchestrator",
        system_prompt=(
            "You are the orchestrator. You NEVER do work yourself — no answering questions, "
            "no writing code, no summarizing. Your ONLY job is to evaluate what needs to be done "
            'and delegate by @mentioning other agents (e.g. "@worker please read the README and '
            'summarize it"). When an agent hands back to you, evaluate their work and either '
            "delegate more work or report the result to the user."
        ),
        tools=[],
        color="#9b7ed8",
        is_default=True,
    ),
    AgentConfig(
        id="worker",
        name="Worker",
        system_prompt=(
            "You are a worker agent. Do the task assigned to you thoroughly. "
            "When done, @orchestrator with a concise summary of what you did."
        ),
        color="#4d9375",
        is_default=False,
    ),
    AgentConfig(
        id="reviewer",
        name="Reviewer",
        system_prompt=(
            "Critique the current direction. Be constructive yet absolutely honest. "
            "When done, @orchestrator with your assessment."
        ),
        tools=["read_file", "glob", "grep"],
        color="#d9a754",
        is_default=False,
    ),
]


def load_global_agents() -> list[AgentConfig]:
    """Load global agent configs (shared across all projects).

    Seeds the default agents file if it doesn't exist.
    """
    path = AGENTS_DIR / "_global.json"
    if not path.exists():
        _save_agents_file(path, DEFAULT_AGENTS)
    return _load_agents_file(path)


def save_global_agents(agents: list[AgentConfig]) -> None:
    _save_agents_file(AGENTS_DIR / "_global.json", agents)


def has_project_agents(project_id: str) -> bool:
    """Check if a project has its own agent overrides."""
    return (AGENTS_DIR / f"{project_id}.json").exists()


def load_project_agents(project_id: str) -> list[AgentConfig]:
    """Load agent configs for a project. Falls back to global agents."""
    p = AGENTS_DIR / f"{project_id}.json"
    if p.exists():
        return _load_agents_file(p)
    return load_global_agents()


def save_project_agents(project_id: str, agents: list[AgentConfig]) -> None:
    _save_agents_file(AGENTS_DIR / f"{project_id}.json", agents)


def delete_project_agents(project_id: str) -> bool:
    """Remove per-project override, reverting to global agents."""
    p = AGENTS_DIR / f"{project_id}.json"
    if p.exists():
        p.unlink()
        return True
    return False


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


def _event_timestamp(event: dict) -> str | None:
    for key in ("timestamp", "created_at", "updated_at", "time", "ts"):
        value = event.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def _compute_last_event_at(convo_id: str, meta: ConvoMeta | None = None) -> str:
    events = read_events(convo_id)
    for event in reversed(events):
        ts = _event_timestamp(event)
        if ts:
            return ts
    base = meta or _read_meta(convo_id)
    if base is not None:
        return base.updated_at
    return _now()


def _hydrate_convo_meta(meta: ConvoMeta) -> ConvoMeta:
    if meta.last_event_at:
        return meta
    return meta.model_copy(update={"last_event_at": _compute_last_event_at(meta.id, meta)})


# ---------------------------------------------------------------------------
# Conversation CRUD
# ---------------------------------------------------------------------------


def list_conversations(project_id: str) -> list[ConvoMeta]:
    _ensure_dirs()
    results: list[ConvoMeta] = []
    for f in CONVOS_DIR.glob("*.meta.json"):
        meta = _hydrate_convo_meta(ConvoMeta(**json.loads(f.read_text())))
        if meta.project_id == project_id:
            results.append(meta)
    results.sort(key=lambda m: m.last_event_at or m.updated_at, reverse=True)
    return results


def list_recent_conversations(limit: int = 10) -> list[ConvoMeta]:
    """Return the most recent non-archived conversations across all projects."""
    _ensure_dirs()
    archived_projects: set[str] = {p["id"] for p in _read_projects() if p.get("archived_at")}
    results: list[ConvoMeta] = []
    for f in CONVOS_DIR.glob("*.meta.json"):
        meta = _hydrate_convo_meta(ConvoMeta(**json.loads(f.read_text())))
        if not meta.archived_at and meta.project_id not in archived_projects:
            results.append(meta)
    results.sort(key=lambda m: m.last_event_at or m.updated_at, reverse=True)
    return results[:limit]


def touch_project(project_id: str) -> Project | None:
    projects = _read_projects()
    now = _now()
    for p in projects:
        if p["id"] == project_id:
            p["updated_at"] = now
            _write_projects(projects)
            return Project(**{**p, "updated_at": p.get("updated_at", p.get("created_at"))})
    return None


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
        archived_at=None,
        autonomous_tools_enabled=False,
    )
    _write_meta(meta)
    touch_project(project_id)
    # Create empty JSONL file
    _messages_path(convo_id).write_text("")
    return meta


def get_conversation(convo_id: str, before: int | None = None, limit: int | None = None) -> ConvoDetail | None:
    meta = _read_meta(convo_id)
    if meta is None:
        return None
    meta = _hydrate_convo_meta(meta)
    events = read_events(convo_id)
    total = len(events)
    end = total if before is None else max(0, min(before, total))
    if limit is None or limit <= 0:
        start = 0
    else:
        start = max(0, end - limit)
    window = events[start:end]
    context_tokens = 0
    context_limit = 0
    for event in reversed(events):
        if event.get("type") == "assistant-message":
            if "context_tokens" in event:
                context_tokens = event["context_tokens"]
                context_limit = event.get("context_limit", 0)
                break
        elif event.get("role") == "assistant" and "context_tokens" in event:
            context_tokens = event["context_tokens"]
            context_limit = event["context_limit"]
            break
    from backend.agent.agents import active_model
    meta_data = meta.model_dump()
    meta_data["model"] = meta.model or active_model
    return ConvoDetail(
        **meta_data,
        messages=window,
        context_tokens=context_tokens,
        context_limit=context_limit,
        has_more=start > 0,
        next_before=start if start > 0 else None,
    )


def delete_conversation(convo_id: str) -> bool:
    meta_p = _meta_path(convo_id)
    if not meta_p.exists():
        return False
    meta_p.unlink()
    msg_p = _messages_path(convo_id)
    if msg_p.exists():
        msg_p.unlink()
    # Remove all agent history files (legacy + per-agent)
    for p in CONVOS_DIR.glob(f"{convo_id}.agent*.json"):
        p.unlink()
    return True


def update_conversation_title(convo_id: str, title: str) -> ConvoMeta | None:
    meta = _read_meta(convo_id)
    if meta is None:
        return None
    meta.title = title
    meta.updated_at = _now()
    _write_meta(meta)
    touch_project(meta.project_id)
    return meta


def update_conversation_status(convo_id: str, status: ConvoStatus) -> ConvoMeta | None:
    meta = _read_meta(convo_id)
    if meta is None:
        return None
    meta.status = status
    meta.updated_at = _now()
    _write_meta(meta)
    touch_project(meta.project_id)
    return meta


def update_conversation_archive(convo_id: str, archived_at: str | None) -> ConvoMeta | None:
    meta = _read_meta(convo_id)
    if meta is None:
        return None
    meta.archived_at = archived_at
    meta.updated_at = _now()
    _write_meta(meta)
    touch_project(meta.project_id)
    return meta


def update_conversation_autonomy(convo_id: str, enabled: bool) -> ConvoMeta | None:
    meta = _read_meta(convo_id)
    if meta is None:
        return None
    meta.autonomous_tools_enabled = enabled
    meta.updated_at = _now()
    _write_meta(meta)
    touch_project(meta.project_id)
    return meta


def update_conversation_model(convo_id: str, model_id: str | None) -> ConvoMeta | None:
    meta = _read_meta(convo_id)
    if meta is None:
        return None
    meta.model = model_id
    meta.updated_at = _now()
    _write_meta(meta)
    touch_project(meta.project_id)
    return meta


# ---------------------------------------------------------------------------
# Message I/O
# ---------------------------------------------------------------------------


def append_event(convo_id: str, event: dict) -> None:
    """Append a single JSON event as a line to the conversation JSONL file."""
    _ensure_dirs()
    p = _messages_path(convo_id)
    with p.open("a") as f:
        f.write(json.dumps(event) + "\n")
    meta = _read_meta(convo_id)
    if meta is not None:
        touch_project(meta.project_id)


def append_message(convo_id: str, event: dict) -> None:
    append_event(convo_id, event)


def _agent_history_path(convo_id: str, agent_id: str | None = None) -> Path:
    if agent_id:
        return CONVOS_DIR / f"{convo_id}.agent.{agent_id}.json"
    return CONVOS_DIR / f"{convo_id}.agent.json"


def save_agent_history(convo_id: str, data: bytes, agent_id: str | None = None) -> None:
    """Save serialized PydanticAI message history."""
    _ensure_dirs()
    _agent_history_path(convo_id, agent_id).write_bytes(data)


def load_agent_history(convo_id: str, agent_id: str | None = None) -> bytes | None:
    """Load serialized PydanticAI message history, if it exists."""
    p = _agent_history_path(convo_id, agent_id)
    if not p.exists():
        # Fallback: try legacy path (no agent_id) for backward compat
        if agent_id:
            return load_agent_history(convo_id, agent_id=None)
        return None
    return p.read_bytes()


def read_events(convo_id: str) -> list[dict]:
    """Read all persisted conversation events from the JSONL file."""
    p = _messages_path(convo_id)
    if not p.exists():
        return []
    events: list[dict] = []
    for line in p.read_text().splitlines():
        line = line.strip()
        if line:
            events.append(json.loads(line))
    return events


def read_messages(convo_id: str) -> list[dict]:
    return read_events(convo_id)
